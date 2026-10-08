import { describe, expect, it } from "vitest";

import {
  createRestVectorInventory,
  inventoryFromSettings,
  VECTOR_LIST_PAGE_SIZE,
  VectorInventoryDeadline,
  VectorInventoryError,
  VectorInventoryRateLimited,
} from "./vector-inventory";

const TOKEN = "tok_SECRET_value_1234567890";
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const INDEX = "useful-brain-staging";

type PageSpec = {
  ids: string[];
  totalCount: number;
  nextCursor?: string | null;
  isTruncated?: boolean;
  cursorExpirationTimestamp?: string;
};

function body(spec: PageSpec): Response {
  return new Response(
    JSON.stringify({
      success: true,
      errors: [],
      messages: [],
      result: {
        count: spec.ids.length,
        isTruncated: spec.isTruncated ?? Boolean(spec.nextCursor),
        totalCount: spec.totalCount,
        vectors: spec.ids.map((id) => ({ id })),
        ...(spec.nextCursor ? { nextCursor: spec.nextCursor } : {}),
        ...(spec.cursorExpirationTimestamp
          ? { cursorExpirationTimestamp: spec.cursorExpirationTimestamp }
          : {}),
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function ids(prefix: string, from: number, to: number): string[] {
  return Array.from({ length: to - from }, (_, index) => `${prefix}-${from + index}`);
}

type Call = { url: URL; authorization: string | null };

/** Fake fetch that answers from a queue of responses and records every call. */
function fakeFetch(responses: Array<Response | Error | ((call: Call) => Response)>) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      url: new URL(String(input)),
      authorization: new Headers(init?.headers).get("authorization"),
    };
    calls.push(call);
    const next = queue.shift();
    if (!next) {
      throw new Error("unexpected extra request");
    }
    if (next instanceof Error) {
      throw next;
    }
    return typeof next === "function" ? next(call) : next;
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

function inventory(
  responses: Parameters<typeof fakeFetch>[0],
  options: { now?: () => number; maxPages?: number; deadlineMs?: number; clock?: { t: number } } = {},
) {
  const sleeps: number[] = [];
  const fake = fakeFetch(responses);
  const port = createRestVectorInventory({
    accountId: ACCOUNT,
    indexName: INDEX,
    apiToken: TOKEN,
    fetch: fake.fetch,
    delayMs: 40,
    sleep: async (ms) => {
      sleeps.push(ms);
      // A clock test lets sleeping move time forward.
      if (options.clock) options.clock.t += ms;
    },
    ...(options.clock ? { now: () => options.clock!.t } : options.now ? { now: options.now } : {}),
    ...(options.maxPages ? { maxPages: options.maxPages } : {}),
    ...(options.deadlineMs ? { deadlineMs: options.deadlineMs } : {}),
  });
  return { port, sleeps, calls: fake.calls };
}

async function failure(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the listing to fail");
}

function expectNoSecrets(error: Error): void {
  const text = `${error.name} ${error.message} ${String(error)} ${error.stack ?? ""}`;
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(ACCOUNT);
  expect(text).not.toContain("api.cloudflare.com");
  expect(text).not.toContain("Bearer");
}

describe("REST vector inventory", () => {
  it("pages across three pages with count=1000, a bearer token and a gap between pages", async () => {
    const all = ids("v", 0, 2500);
    const { port, calls, sleeps } = inventory([
      body({ ids: all.slice(0, 1000), totalCount: 2500, nextCursor: "c1" }),
      body({ ids: all.slice(1000, 2000), totalCount: 2500, nextCursor: "c2" }),
      body({ ids: all.slice(2000), totalCount: 2500 }),
    ]);
    const listing = await port.listAll();
    expect(listing.totalCount).toBe(2500);
    expect(listing.ids).toEqual(all);
    expect(calls).toHaveLength(3);
    expect(VECTOR_LIST_PAGE_SIZE).toBe(1000);
    for (const call of calls) {
      expect(call.url.origin).toBe("https://api.cloudflare.com");
      expect(call.url.pathname).toBe(`/client/v4/accounts/${ACCOUNT}/vectorize/v2/indexes/${INDEX}/list`);
      expect(call.url.searchParams.get("count")).toBe("1000");
      expect(call.authorization).toBe(`Bearer ${TOKEN}`);
    }
    expect(calls[0].url.searchParams.has("cursor")).toBe(false);
    expect(calls[1].url.searchParams.get("cursor")).toBe("c1");
    expect(calls[2].url.searchParams.get("cursor")).toBe("c2");
    expect(sleeps).toEqual([40, 40]);
  });

  it("lists an empty index in one request", async () => {
    const { port, calls } = inventory([body({ ids: [], totalCount: 0 })]);
    expect(await port.listAll()).toEqual({ ids: [], totalCount: 0 });
    expect(calls).toHaveLength(1);
  });

  it("restarts the sequence once when the cursor has expired, and returns only the fresh listing", async () => {
    const stale = ids("old", 0, 1000);
    const fresh = ids("v", 0, 1500);
    const { port, calls } = inventory([
      body({ ids: stale, totalCount: 1500, nextCursor: "c1" }),
      new Response(JSON.stringify({ success: false, errors: [{ code: 7003, message: "cursor expired" }], result: null }), { status: 400 }),
      body({ ids: fresh.slice(0, 1000), totalCount: 1500, nextCursor: "d1" }),
      body({ ids: fresh.slice(1000), totalCount: 1500 }),
    ]);
    const listing = await port.listAll();
    expect(listing.ids).toEqual(fresh);
    expect(calls).toHaveLength(4);
    expect(calls[2].url.searchParams.has("cursor")).toBe(false);
  });

  it("restarts when the cursor's expiry timestamp has already passed", async () => {
    const fresh = ids("v", 0, 1200);
    let clock = Date.parse("2026-10-08T12:00:00Z");
    const { port, calls } = inventory(
      [
        body({ ids: ids("old", 0, 1000), totalCount: 1200, nextCursor: "c1", cursorExpirationTimestamp: "2026-10-08T12:00:05Z" }),
        body({ ids: fresh.slice(0, 1000), totalCount: 1200, nextCursor: "d1", cursorExpirationTimestamp: "2026-10-08T12:10:00Z" }),
        body({ ids: fresh.slice(1000), totalCount: 1200 }),
      ],
      { now: () => (clock += 10_000) },
    );
    const listing = await port.listAll();
    expect(listing.ids).toEqual(fresh);
    expect(calls).toHaveLength(3);
    expect(calls[1].url.searchParams.has("cursor")).toBe(false);
  });

  it("gives up when the cursor expires on the restart too", async () => {
    const expired = () => new Response(JSON.stringify({ success: false, errors: [{ code: 7003 }] }), { status: 400 });
    const { port, calls } = inventory([
      body({ ids: ids("a", 0, 1000), totalCount: 2000, nextCursor: "c1" }),
      expired(),
      body({ ids: ids("b", 0, 1000), totalCount: 2000, nextCursor: "d1" }),
      expired(),
    ]);
    const error = await failure(port.listAll());
    expect(error).toBeInstanceOf(VectorInventoryError);
    expect(calls).toHaveLength(4);
    expectNoSecrets(error);
  });

  it("accepts short pages: count is a maximum, so 1000 ids as four 250-id pages is a complete listing", async () => {
    const all = ids("v", 0, 1000);
    const { port, calls } = inventory([
      body({ ids: all.slice(0, 250), totalCount: 1000, nextCursor: "c1" }),
      body({ ids: all.slice(250, 500), totalCount: 1000, nextCursor: "c2" }),
      body({ ids: all.slice(500, 750), totalCount: 1000, nextCursor: "c3" }),
      body({ ids: all.slice(750), totalCount: 1000 }),
    ]);
    const listing = await port.listAll();
    expect(listing.ids).toEqual(all);
    expect(calls).toHaveLength(4);
  });

  it("fails closed when a truncated page adds no new ids", async () => {
    const same = (cursor: string) => body({ ids: ids("v", 0, 500), totalCount: 1000, nextCursor: cursor });
    const { port, calls } = inventory([same("c1"), same("c2"), same("c3"), same("c4")]);
    const error = await failure(port.listAll());
    expect(error).toBeInstanceOf(VectorInventoryError);
    expect(error.message).toMatch(/no progress/);
    expect(calls).toHaveLength(2);
    expectNoSecrets(error);
  });

  it("fails closed when the cursor repeats", async () => {
    const { port } = inventory([
      body({ ids: ids("a", 0, 100), totalCount: 1000, nextCursor: "same" }),
      body({ ids: ids("b", 0, 100), totalCount: 1000, nextCursor: "same" }),
      body({ ids: ids("c", 0, 100), totalCount: 1000, nextCursor: "same" }),
    ]);
    const error = await failure(port.listAll());
    expect(error.message).toMatch(/repeated a cursor/);
  });

  it("fails closed when unique ids exceed the first page's totalCount", async () => {
    const { port } = inventory([
      body({ ids: ids("a", 0, 600), totalCount: 1000, nextCursor: "c1" }),
      body({ ids: ids("b", 0, 600), totalCount: 1000 }),
    ]);
    const error = await failure(port.listAll());
    expect(error.message).toMatch(/more ids than totalCount/);
  });

  it("stops at the safety cap on pages even when every page makes progress", async () => {
    const page = (n: number) => body({ ids: ids(`p${n}`, 0, 10), totalCount: 100_000, nextCursor: `c${n}` });
    const { port, calls } = inventory([page(1), page(2), page(3), page(4), page(5)], { maxPages: 3 });
    const error = await failure(port.listAll());
    expect(error.message).toMatch(/page limit/);
    expect(calls).toHaveLength(3);
  });

  it("rejects a count that disagrees with the vectors returned", async () => {
    const lying = new Response(
      JSON.stringify({
        success: true,
        result: { count: 5, isTruncated: false, totalCount: 2, vectors: [{ id: "a" }, { id: "b" }] },
      }),
    );
    const { port } = inventory([lying]);
    expect(await failure(port.listAll())).toBeInstanceOf(VectorInventoryError);
    const missing = new Response(
      JSON.stringify({ success: true, result: { isTruncated: false, totalCount: 1, vectors: [{ id: "a" }] } }),
    );
    expect(await failure(inventory([missing]).port.listAll())).toBeInstanceOf(VectorInventoryError);
  });

  it("each malformed fixture fails at its own guard, not at the count check", async () => {
    const run = (result: Record<string, unknown>) =>
      failure(inventory([new Response(JSON.stringify({ success: true, result }), { status: 200 })]).port.listAll());
    expect((await run({ count: 1, vectors: [{ id: "a" }], totalCount: 5, isTruncated: true })).message).toMatch(/without a cursor/);
    // These only reach their own guard because count is valid; a bad one is rejected on its own.
    expect(await run({ count: 1, vectors: [{ id: 7 }], totalCount: 1, isTruncated: false })).toBeInstanceOf(VectorInventoryError);
    expect(await run({ count: 1, vectors: [{ id: "a" }], totalCount: -1, isTruncated: false })).toBeInstanceOf(VectorInventoryError);
    expect(await run({ count: 1, vectors: [{ id: "a" }], totalCount: 1, isTruncated: "no" })).toBeInstanceOf(VectorInventoryError);
  });

  it("honours Retry-After on a 429 within a bounded budget, then continues", async () => {
    const limited = (seconds: string) => new Response("slow down", { status: 429, headers: { "retry-after": seconds } });
    const { port, sleeps, calls } = inventory([limited("2"), limited("3"), body({ ids: ids("v", 0, 3), totalCount: 3 })]);
    const listing = await port.listAll();
    expect(listing.ids).toHaveLength(3);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 3000]);
  });

  it("throws a typed rate-limit error when Retry-After is missing, too long, or the budget is spent", async () => {
    const limited = (headers?: Record<string, string>) => new Response("slow down", { status: 429, headers });
    const none = inventory([limited()]);
    const noHeader = await failure(none.port.listAll());
    expect(noHeader).toBeInstanceOf(VectorInventoryRateLimited);
    expect(none.sleeps).toEqual([]);
    expectNoSecrets(noHeader);

    const tooLong = inventory([limited({ "retry-after": "61" })]);
    expect(await failure(tooLong.port.listAll())).toBeInstanceOf(VectorInventoryRateLimited);
    expect(tooLong.sleeps).toEqual([]);

    const spent = inventory([limited({ "retry-after": "40" }), limited({ "retry-after": "40" }), limited({ "retry-after": "40" })]);
    const error = await failure(spent.port.listAll());
    expect(error).toBeInstanceOf(VectorInventoryRateLimited);
    expect(error.name).toBe("VectorInventoryRateLimited");
    // 40s fits the 60s total budget, a second 40s does not.
    expect(spent.sleeps).toEqual([40_000]);
    expectNoSecrets(error);
  });

  it("fails closed when the pages add up to fewer ids than totalCount", async () => {
    const { port } = inventory([body({ ids: ids("v", 0, 999), totalCount: 1000 })]);
    const error = await failure(port.listAll());
    expect(error).toBeInstanceOf(VectorInventoryError);
    expect(error.message).toMatch(/incomplete/);
  });

  it("throws on a non-2xx status without retrying auth or server errors", async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      const { port, calls } = inventory([new Response("nope", { status })]);
      const error = await failure(port.listAll());
      expect(error).toBeInstanceOf(VectorInventoryError);
      expect(error.message).toContain(String(status));
      expect(calls).toHaveLength(1);
      expectNoSecrets(error);
    }
  });

  it("throws when the body says success is false, even on HTTP 200", async () => {
    const { port } = inventory([
      new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: `bad token ${TOKEN}` }], result: null }), { status: 200 }),
    ]);
    const error = await failure(port.listAll());
    expect(error).toBeInstanceOf(VectorInventoryError);
    expectNoSecrets(error);
  });

  it("throws on malformed bodies", async () => {
    const bodies: unknown[] = [
      "not json at all",
      { success: true },
      { success: true, result: { count: 0, vectors: "nope", totalCount: 1, isTruncated: false } },
      { success: true, result: { count: 1, vectors: [{ id: 1 }], totalCount: 1, isTruncated: false } },
      { success: true, result: { count: 1, vectors: [{ id: "a" }], totalCount: "1", isTruncated: false } },
      { success: true, result: { count: 1, vectors: [{ id: "a" }], totalCount: 5, isTruncated: true } },
    ];
    for (const raw of bodies) {
      const text = typeof raw === "string" ? raw : JSON.stringify(raw);
      const { port } = inventory([new Response(text, { status: 200 })]);
      const error = await failure(port.listAll());
      expect(error).toBeInstanceOf(VectorInventoryError);
      expectNoSecrets(error);
    }
  });

  it("never leaks the token, account id or URL, even when fetch itself throws them", async () => {
    const leaky = new TypeError(`connect failed https://api.cloudflare.com/client/v4/accounts/${ACCOUNT} Bearer ${TOKEN}`);
    const { port } = inventory([leaky]);
    const error = await failure(port.listAll());
    expect(error).toBeInstanceOf(VectorInventoryError);
    expectNoSecrets(error);
  });

  it("rejects a malformed account id or index name before any request", async () => {
    const fake = fakeFetch([]);
    for (const bad of [{ accountId: "../x" }, { indexName: "a/b" }, { indexName: "" }, { apiToken: "" }]) {
      const port = createRestVectorInventory({
        accountId: ACCOUNT,
        indexName: INDEX,
        apiToken: TOKEN,
        fetch: fake.fetch,
        sleep: async () => {},
        ...bad,
      });
      const error = await failure(port.listAll());
      expect(error).toBeInstanceOf(VectorInventoryError);
      expectNoSecrets(error);
    }
    expect(fake.calls).toHaveLength(0);
  });
});

describe("REST vector inventory limits", () => {
  const limited = (retryAfter?: string) =>
    new Response("slow down", { status: 429, headers: retryAfter === undefined ? {} : { "retry-after": retryAfter } });

  it("stops after five 429 retries even when Retry-After is 0", async () => {
    const { port, calls, sleeps } = inventory(Array.from({ length: 8 }, () => limited("0")));
    const error = await failure(port.listAll());
    expect(error).toBeInstanceOf(VectorInventoryRateLimited);
    expect(calls).toHaveLength(6);
    expect(sleeps).toEqual([0, 0, 0, 0, 0]);
  });

  it("stops after five retries when Retry-After is an HTTP date in the past", async () => {
    const { port, calls } = inventory(Array.from({ length: 8 }, () => limited("Wed, 21 Oct 2015 07:28:00 GMT")));
    const error = await failure(port.listAll());
    expect(error).toBeInstanceOf(VectorInventoryRateLimited);
    expect(calls).toHaveLength(6);
  });

  it("waits for a future HTTP date within the limit", async () => {
    const clock = { t: Date.parse("2026-10-08T12:00:00Z") };
    const { port, sleeps } = inventory(
      [limited("Thu, 08 Oct 2026 12:00:07 GMT"), body({ ids: ids("v", 0, 2), totalCount: 2 })],
      { clock },
    );
    expect((await port.listAll()).ids).toHaveLength(2);
    expect(sleeps).toEqual([7000]);
  });

  it("rejects malformed Retry-After values without waiting or retrying", async () => {
    for (const bad of ["-1", "abc", "1.5", "1e3", "", " ", "1 2", "99999999", "2015-10-21"]) {
      const { port, calls, sleeps } = inventory([limited(bad), limited(bad)]);
      const error = await failure(port.listAll());
      expect(error, bad).toBeInstanceOf(VectorInventoryRateLimited);
      expect(calls, bad).toHaveLength(1);
      expect(sleeps, bad).toEqual([]);
    }
  });

  it("fails with a typed, name-safe error when the wall-clock deadline passes between pages", async () => {
    const clock = { t: 1_000_000 };
    const page = (n: number, last = false) =>
      body({ ids: ids(`p${n}`, 0, 10), totalCount: 30, ...(last ? {} : { nextCursor: `c${n}` }) });
    const { port, calls, sleeps } = inventory([page(1), page(2), page(3, true)], { clock, deadlineMs: 70 });
    const error = await failure(port.listAll());
    expect(error).toBeInstanceOf(VectorInventoryDeadline);
    expect(error.name).toBe("VectorInventoryDeadline");
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([40]); // the second gap would have crossed the deadline, so it is not slept
    expectNoSecrets(error);
  });

  it("does not sleep through a Retry-After that would cross the deadline", async () => {
    const clock = { t: 5_000 };
    const { port, sleeps } = inventory([limited("50"), body({ ids: [], totalCount: 0 })], { clock, deadlineMs: 40_000 });
    expect(await failure(port.listAll())).toBeInstanceOf(VectorInventoryDeadline);
    expect(sleeps).toEqual([]);
  });

  it("a healthy scan of 100 full pages finishes inside the deadline at the default gap", async () => {
    const clock = { t: 0 };
    const responses = Array.from({ length: 100 }, (_, n) =>
      body({ ids: ids(`p${n}`, 0, 1000), totalCount: 100_000, ...(n < 99 ? { nextCursor: `c${n}` } : {}) }),
    );
    const sleeps: number[] = [];
    const fake = fakeFetch(responses);
    const port = createRestVectorInventory({
      accountId: ACCOUNT,
      indexName: INDEX,
      apiToken: TOKEN,
      fetch: async (...args) => {
        clock.t += 500; // request latency
        return fake.fetch(...args);
      },
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.t += ms;
      },
      now: () => clock.t,
    });
    expect((await port.listAll()).ids).toHaveLength(100_000);
    expect(sleeps.every((ms) => ms === 100)).toBe(true);
    expect(clock.t).toBeLessThan(240_000);
  });
});

describe("inventory settings", () => {
  const all = { VECTORIZE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, VECTORIZE_INDEX_NAME: INDEX };

  it("builds a listing only when all three settings are present", () => {
    const full = inventoryFromSettings(all);
    expect(full.inventory).not.toBeNull();
    expect(full).toMatchObject({ partlyConfigured: false, missing: [] });
  });

  it("the deployed shape, with only the plain index var, is binding-only", () => {
    expect(inventoryFromSettings({ VECTORIZE_INDEX_NAME: "useful-brain-staging" })).toEqual({
      inventory: null,
      partlyConfigured: false,
      missing: [],
    });
    expect(inventoryFromSettings({})).toEqual({ inventory: null, partlyConfigured: false, missing: [] });
    expect(
      inventoryFromSettings({ VECTORIZE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "", VECTORIZE_INDEX_NAME: INDEX }).partlyConfigured,
    ).toBe(false);
  });

  it("exactly one secret, or both secrets without an index name, is partly configured and names only what is missing", () => {
    const cases: Array<[Record<string, string>, string[]]> = [
      [{ VECTORIZE_API_TOKEN: TOKEN, VECTORIZE_INDEX_NAME: INDEX }, ["CLOUDFLARE_ACCOUNT_ID"]],
      [{ CLOUDFLARE_ACCOUNT_ID: ACCOUNT, VECTORIZE_INDEX_NAME: INDEX }, ["VECTORIZE_API_TOKEN"]],
      [{ VECTORIZE_API_TOKEN: TOKEN }, ["CLOUDFLARE_ACCOUNT_ID", "VECTORIZE_INDEX_NAME"]],
      [{ VECTORIZE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT }, ["VECTORIZE_INDEX_NAME"]],
    ];
    for (const [settings, missing] of cases) {
      const result = inventoryFromSettings(settings);
      expect(result.inventory).toBeNull();
      expect(result.partlyConfigured).toBe(true);
      expect(result.missing).toEqual(missing);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
  });
});
