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
const DEFAULT_PAGE_GAP_MS = 250;
/** A 429 with a Retry-After above this is thrown, not waited out. */
const MAX_RETRY_AFTER_MS = 60_000;
/** Total time one listAll may spend waiting on 429s. Fits the 5-minute reconcile step. */
const RATE_LIMIT_WAIT_BUDGET_MS = 120_000;
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

/** Retry-After as milliseconds, from delta-seconds or an HTTP date. Null when absent or unusable. */
function retryAfterMs(response: Response, now: number): number | null {
  const header = response.headers.get("retry-after");
  if (header === null || header.trim() === "") {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export function createRestVectorInventory(config: RestVectorInventoryConfig): VectorInventory {
  const doFetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  const delayMs = config.delayMs ?? DEFAULT_PAGE_GAP_MS;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = config.now ?? Date.now;

  async function requestPage(cursor: string | null, budget: { waitedMs: number }): Promise<Page> {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/vectorize/v2/indexes/${config.indexName}/list`,
    );
    url.searchParams.set("count", String(VECTOR_LIST_PAGE_SIZE));
    if (cursor !== null) {
      url.searchParams.set("cursor", cursor);
    }
    let response: Response;
    for (;;) {
      try {
        response = await doFetch(url.toString(), {
          method: "GET",
          headers: { authorization: `Bearer ${config.apiToken}`, accept: "application/json" },
        });
      } catch {
        // The platform error text can echo the URL. Say only what failed.
        throw new VectorInventoryError("list request failed: network error");
      }
      if (response.status !== 429) {
        break;
      }
      const wait = retryAfterMs(response, now());
      if (wait === null || wait > MAX_RETRY_AFTER_MS || budget.waitedMs + wait > RATE_LIMIT_WAIT_BUDGET_MS) {
        throw new VectorInventoryRateLimited("list request failed: HTTP 429");
      }
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
    } catch {
      throw new VectorInventoryError("list response is malformed");
    }
    if (isRecord(raw) && raw.success === false) {
      throw new VectorInventoryError("list request failed: the API reported an error");
    }
    return parsePage(raw);
  }

  async function sequence(budget: { waitedMs: number }): Promise<VectorListing> {
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
      await sleep(delayMs);
      page = await requestPage(page.nextCursor, budget);
    }
    if (ids.size < totalCount) {
      throw new VectorInventoryError("list is incomplete");
    }
    return { ids: [...ids], totalCount };
  }

  return {
    async listAll() {
      if (!ACCOUNT_ID.test(config.accountId) || !INDEX_NAME.test(config.indexName) || config.apiToken.length === 0) {
        throw new VectorInventoryError("inventory configuration is invalid");
      }
      const budget = { waitedMs: 0 };
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

const SETTING_NAMES = ["VECTORIZE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "VECTORIZE_INDEX_NAME"] as const;

/**
 * Builds the REST inventory from the worker's settings. None set means
 * binding-only. All three set means a listing. Anything in between is a
 * configuration mistake the caller must fail closed on; `missing` holds the
 * setting names (never values) that are absent.
 */
export function inventoryFromSettings(settings: InventorySettings): {
  inventory: VectorInventory | null;
  partlyConfigured: boolean;
  missing: string[];
} {
  const missing = SETTING_NAMES.filter((name) => !settings[name]);
  if (missing.length === SETTING_NAMES.length) {
    return { inventory: null, partlyConfigured: false, missing: [...missing] };
  }
  if (missing.length > 0) {
    return { inventory: null, partlyConfigured: true, missing: [...missing] };
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
