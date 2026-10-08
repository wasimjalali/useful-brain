/**
 * Full Vectorize id listing for draft reconciliation. The Worker binding has no
 * list call, so this reads the REST API with a Vectorize Read token. Its errors
 * never carry the token, the account id or the request URL.
 */
export type VectorListing = { ids: string[]; totalCount: number };

export type VectorInventory = {
  /** Every vector id in the index, from one consistent snapshot. Throws, never returns a partial list. */
  listAll(): Promise<VectorListing>;
};

export class VectorInventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorInventoryError";
  }
}

/** A maximum: the API may return shorter pages, so progress is checked per page instead of counted. */
export const VECTOR_LIST_PAGE_SIZE = 1000;
/** Generous safety cap on pages in one sequence. Termination itself comes from the progress checks. */
export const MAX_LIST_PAGES = 1000;
const DEFAULT_PAGE_GAP_MS = 100;
/** Retries of one page after a 429, however short the Retry-After. */
const MAX_RATE_LIMIT_RETRIES = 5;
/** Wall-clock limit for one listAll, waits included. Inside the 5-minute reconcile step. */
const LIST_DEADLINE_MS = 240_000;
/** A 429 with a Retry-After above this is thrown, not waited out. */
const MAX_RETRY_AFTER_MS = 60_000;
/** Total time one listAll may spend waiting on 429s. */
const RATE_LIMIT_WAIT_BUDGET_MS = 60_000;
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const INDEX_NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** Statuses where a cursor request cannot be told apart from an expired cursor. */
const CURSOR_REJECTED = new Set([400, 404, 410]);

export type RestVectorInventoryConfig = {
  accountId: string;
  indexName: string;
  apiToken: string;
  fetch?: typeof globalThis.fetch;
  /** Gap between page requests, for the API's rate limits. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxPages?: number;
  deadlineMs?: number;
};

type Page = {
  ids: string[];
  totalCount: number;
  nextCursor: string | null;
  cursorExpiresAt: number | null;
};

/** The API kept answering 429 beyond what listAll may wait. Typed so a caller can tell it from a fault. */
export class VectorInventoryRateLimited extends VectorInventoryError {
  constructor(message: string) {
    super(message);
    this.name = "VectorInventoryRateLimited";
  }
}

/** The listing ran past its wall-clock limit. Typed so a caller can tell it from a fault. */
export class VectorInventoryDeadline extends VectorInventoryError {
  constructor() {
    super("list exceeded its time limit");
    this.name = "VectorInventoryDeadline";
  }
}

/** The cursor was rejected or has expired. Internal: triggers one restart. */
class CursorExpired extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePage(raw: unknown): Page {
  const result = isRecord(raw) && raw.success === true ? raw.result : undefined;
  if (!isRecord(result) || !Array.isArray(result.vectors)) {
    throw new VectorInventoryError("list response is malformed");
  }
  const { totalCount, isTruncated, count } = result;
  if (typeof count !== "number" || count !== result.vectors.length) {
    throw new VectorInventoryError("list response is malformed");
  }
  if (typeof totalCount !== "number" || !Number.isInteger(totalCount) || totalCount < 0) {
    throw new VectorInventoryError("list response is malformed");
  }
  if (typeof isTruncated !== "boolean") {
    throw new VectorInventoryError("list response is malformed");
  }
  const ids = result.vectors.map((vector) => {
    if (!isRecord(vector) || typeof vector.id !== "string" || vector.id.length === 0) {
      throw new VectorInventoryError("list response is malformed");
    }
    return vector.id;
  });
  const nextCursor = typeof result.nextCursor === "string" && result.nextCursor.length > 0 ? result.nextCursor : null;
  if (isTruncated && nextCursor === null) {
    // More ids exist but nothing says where: an incomplete listing, never a complete one.
    throw new VectorInventoryError("list response is truncated without a cursor");
  }
  const expiry = result.cursorExpirationTimestamp;
  const parsedExpiry =
    typeof expiry === "number" ? expiry : typeof expiry === "string" ? Date.parse(expiry) : Number.NaN;
  return {
    ids,
    totalCount,
    nextCursor: isTruncated ? nextCursor : null,
    cursorExpiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : null,
  };
}

/**
 * Retry-After as milliseconds. Only whole delta-seconds are honoured. The
 * HTTP-date form is not parsed (its three legacy formats are easy to get
 * wrong), so a date or anything else is null and the attempt fails.
 */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after")?.trim();
  return header && /^\d{1,6}$/.test(header) ? Number(header) * 1000 : null;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

type Budget = { waitedMs: number; startedAt: number };

export function createRestVectorInventory(config: RestVectorInventoryConfig): VectorInventory {
  const doFetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  const delayMs = config.delayMs ?? DEFAULT_PAGE_GAP_MS;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = config.now ?? Date.now;

  /** Milliseconds left before the deadline, less a wait about to be slept. Throws when none are left. */
  function remainingMs(budget: Budget, upcomingWaitMs = 0): number {
    const left = (config.deadlineMs ?? LIST_DEADLINE_MS) - (now() - budget.startedAt) - upcomingWaitMs;
    if (left < 0) {
      throw new VectorInventoryDeadline();
    }
    return left;
  }

  async function requestPage(cursor: string | null, budget: Budget): Promise<Page> {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/vectorize/v2/indexes/${config.indexName}/list`,
    );
    url.searchParams.set("count", String(VECTOR_LIST_PAGE_SIZE));
    if (cursor !== null) {
      url.searchParams.set("cursor", cursor);
    }
    let response: Response;
    for (let retries = 0; ; retries += 1) {
      // The signal bounds the request and, once fetch resolves, the body read too.
      const signal = AbortSignal.timeout(remainingMs(budget));
      try {
        response = await doFetch(url.toString(), {
          method: "GET",
          headers: { authorization: `Bearer ${config.apiToken}`, accept: "application/json" },
          signal,
        });
      } catch (error) {
        if (isTimeout(error)) {
          throw new VectorInventoryDeadline();
        }
        // The platform error text can echo the URL. Say only what failed.
        throw new VectorInventoryError("list request failed: network error");
      }
      if (response.status !== 429) {
        break;
      }
      const wait = retryAfterMs(response);
      if (
        wait === null ||
        retries >= MAX_RATE_LIMIT_RETRIES ||
        wait > MAX_RETRY_AFTER_MS ||
        budget.waitedMs + wait > RATE_LIMIT_WAIT_BUDGET_MS
      ) {
        throw new VectorInventoryRateLimited("list request failed: HTTP 429");
      }
      remainingMs(budget, wait);
      budget.waitedMs += wait;
      await sleep(wait);
    }
    if (!response.ok) {
      if (cursor !== null && CURSOR_REJECTED.has(response.status)) {
        throw new CursorExpired();
      }
      throw new VectorInventoryError(`list request failed: HTTP ${response.status}`);
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch (error) {
      if (isTimeout(error)) {
        throw new VectorInventoryDeadline();
      }
      throw new VectorInventoryError("list response is malformed");
    }
    if (isRecord(raw) && raw.success === false) {
      throw new VectorInventoryError("list request failed: the API reported an error");
    }
    return parsePage(raw);
  }

  async function sequence(budget: Budget): Promise<VectorListing> {
    const ids = new Set<string>();
    const cursors = new Set<string>();
    const first = await requestPage(null, budget);
    const totalCount = first.totalCount;
    const maxPages = config.maxPages ?? MAX_LIST_PAGES;
    let page = first;
    for (let fetched = 1; ; fetched += 1) {
      const before = ids.size;
      for (const id of page.ids) {
        ids.add(id);
      }
      if (ids.size > totalCount) {
        throw new VectorInventoryError("list returned more ids than totalCount");
      }
      if (page.nextCursor === null) {
        break;
      }
      // Pages may be short, so progress is judged by what each page adds.
      if (ids.size === before) {
        throw new VectorInventoryError("list made no progress");
      }
      if (cursors.has(page.nextCursor)) {
        throw new VectorInventoryError("list repeated a cursor");
      }
      cursors.add(page.nextCursor);
      if (fetched >= maxPages) {
        throw new VectorInventoryError("list exceeded its page limit");
      }
      if (page.cursorExpiresAt !== null && now() >= page.cursorExpiresAt) {
        throw new CursorExpired();
      }
      remainingMs(budget, delayMs);
      await sleep(delayMs);
      page = await requestPage(page.nextCursor, budget);
    }
    if (ids.size < totalCount) {
      throw new VectorInventoryError("list is incomplete");
    }
    // A listing that finished after the deadline is not returned: the step is out of time anyway.
    remainingMs(budget);
    return { ids: [...ids], totalCount };
  }

  return {
    async listAll() {
      if (!ACCOUNT_ID.test(config.accountId) || !INDEX_NAME.test(config.indexName) || config.apiToken.length === 0) {
        throw new VectorInventoryError("inventory configuration is invalid");
      }
      const budget: Budget = { waitedMs: 0, startedAt: now() };
      try {
        return await sequence(budget);
      } catch (error) {
        if (!(error instanceof CursorExpired)) {
          throw error;
        }
      }
      // Cursors expire. Restart once from a fresh snapshot, never stitch two snapshots together.
      try {
        return await sequence(budget);
      } catch (error) {
        if (error instanceof CursorExpired) {
          throw new VectorInventoryError("list cursor expired twice");
        }
        throw error;
      }
    },
  };
}

export type InventorySettings = {
  VECTORIZE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  VECTORIZE_INDEX_NAME?: string;
};

/**
 * Builds the REST inventory from the worker's settings. The two secrets decide
 * whether the feature is on: neither set means binding-only, whatever the
 * index name (a plain var present in every environment). Both secrets plus the
 * index name means a listing. Anything else (one secret, or both without an
 * index name) is a configuration mistake the caller must fail closed on.
 * `missing` holds setting names (never values) for the warning log.
 */
export function inventoryFromSettings(settings: InventorySettings): {
  inventory: VectorInventory | null;
  partlyConfigured: boolean;
  missing: string[];
} {
  const hasToken = Boolean(settings.VECTORIZE_API_TOKEN);
  const hasAccount = Boolean(settings.CLOUDFLARE_ACCOUNT_ID);
  const hasIndex = Boolean(settings.VECTORIZE_INDEX_NAME);
  if (!hasToken && !hasAccount) {
    return { inventory: null, partlyConfigured: false, missing: [] };
  }
  if (!hasToken || !hasAccount || !hasIndex) {
    const missing = [
      ...(hasToken ? [] : ["VECTORIZE_API_TOKEN"]),
      ...(hasAccount ? [] : ["CLOUDFLARE_ACCOUNT_ID"]),
      ...(hasIndex ? [] : ["VECTORIZE_INDEX_NAME"]),
    ];
    return { inventory: null, partlyConfigured: true, missing };
  }
  return {
    inventory: createRestVectorInventory({
      apiToken: settings.VECTORIZE_API_TOKEN as string,
      accountId: settings.CLOUDFLARE_ACCOUNT_ID as string,
      indexName: settings.VECTORIZE_INDEX_NAME as string,
    }),
    partlyConfigured: false,
    missing: [],
  };
}
