import { describe, expect, it } from "vitest";

import {
  createRestVectorInventory,
  VECTOR_LIST_PAGE_SIZE,
  VectorInventoryError,
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
  options: { now?: () => number } = {},
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
    },
    ...(options.now ? { now: options.now } : {}),
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

  it("fails closed when the server keeps paging past the cap derived from totalCount", async () => {
    // totalCount 1000 allows one page plus two spare. A fourth request is a runaway.
    const endless = () => body({ ids: ids("v", 0, 1000), totalCount: 1000, nextCursor: "again" });
    const { port, calls } = inventory([endless(), endless(), endless(), endless(), endless()]);
    const error = await failure(port.listAll());
    expect(error).toBeInstanceOf(VectorInventoryError);
    expect(error.message).toMatch(/page limit/);
    expect(calls.length).toBeLessThanOrEqual(4);
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
      { success: true, result: { vectors: "nope", totalCount: 1, isTruncated: false } },
      { success: true, result: { vectors: [{ id: 1 }], totalCount: 1, isTruncated: false } },
      { success: true, result: { vectors: [{ id: "a" }], totalCount: "1", isTruncated: false } },
      { success: true, result: { vectors: [{ id: "a" }], totalCount: 5, isTruncated: true } },
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
