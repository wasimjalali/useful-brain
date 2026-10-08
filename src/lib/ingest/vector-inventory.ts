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

export const VECTOR_LIST_PAGE_SIZE = 1000;
/** Pages beyond the count totalCount implies. Absorbs an off-by-one, not a runaway cursor. */
const SPARE_PAGES = 2;
const DEFAULT_PAGE_GAP_MS = 250;
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
};

type Page = {
  ids: string[];
  totalCount: number;
  nextCursor: string | null;
  cursorExpiresAt: number | null;
};

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
  const { totalCount, isTruncated } = result;
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

export function createRestVectorInventory(config: RestVectorInventoryConfig): VectorInventory {
  const doFetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  const delayMs = config.delayMs ?? DEFAULT_PAGE_GAP_MS;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = config.now ?? Date.now;

  async function requestPage(cursor: string | null): Promise<Page> {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/vectorize/v2/indexes/${config.indexName}/list`,
    );
    url.searchParams.set("count", String(VECTOR_LIST_PAGE_SIZE));
    if (cursor !== null) {
      url.searchParams.set("cursor", cursor);
    }
    let response: Response;
    try {
      response = await doFetch(url.toString(), {
        method: "GET",
        headers: { authorization: `Bearer ${config.apiToken}`, accept: "application/json" },
      });
    } catch {
      // The platform error text can echo the URL. Say only what failed.
      throw new VectorInventoryError("list request failed: network error");
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

  async function sequence(): Promise<VectorListing> {
    const ids = new Set<string>();
    const first = await requestPage(null);
    const totalCount = first.totalCount;
    const maxPages = Math.ceil(totalCount / VECTOR_LIST_PAGE_SIZE) + SPARE_PAGES;
    let page = first;
    for (let fetched = 1; ; fetched += 1) {
      for (const id of page.ids) {
        ids.add(id);
      }
      if (page.nextCursor === null) {
        break;
      }
      if (fetched >= maxPages) {
        throw new VectorInventoryError("list exceeded its page limit");
      }
      if (page.cursorExpiresAt !== null && now() >= page.cursorExpiresAt) {
        throw new CursorExpired();
      }
      await sleep(delayMs);
      page = await requestPage(page.nextCursor);
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
      try {
        return await sequence();
      } catch (error) {
        if (!(error instanceof CursorExpired)) {
          throw error;
        }
      }
      // Cursors expire. Restart once from a fresh snapshot, never stitch two snapshots together.
      try {
        return await sequence();
      } catch (error) {
        if (error instanceof CursorExpired) {
          throw new VectorInventoryError("list cursor expired twice");
        }
        throw error;
      }
    },
  };
}
