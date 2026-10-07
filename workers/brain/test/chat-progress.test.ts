import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { executeTurn } from "../../../src/lib/brain/execute-turn";
import { countReadableDocuments } from "../../../src/lib/acl/access";
import { createPendingTurn } from "../../../src/lib/store/conversations";
import {
  CHAT_CORPUS_TOTAL,
  MAYA,
  PRIYA,
  call,
  recordingLock,
  seedChatCorpus,
} from "./chat-helpers";
import { seedPersonas, seedPrincipals, type PersonaId } from "./seed";

let cookies: Record<PersonaId, string>;
let generationId: string;

beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
  generationId = (await seedChatCorpus()).generationId;
});

describe("conversation lock progress union", () => {
  async function lock(name: string) {
    const stub = env.CONVERSATION.getByName(name);
    await stub.acquire("run-1");
    return stub;
  }

  it("rejects a count that is not a bounded integer", async () => {
    const stub = await lock("lock-bad-counts");
    for (const bad of [-1, 1.5, 100001, Number.NaN, Number.POSITIVE_INFINITY, "7", null, {}, [1]]) {
      expect(await stub.setStage("run-1", "searching", bad as never)).toEqual({ ok: false, status: 400 });
    }
    expect(await stub.setStage("run-1", "searching")).toEqual({ ok: false, status: 400 });
    expect(await stub.setStage("run-1", "reading")).toEqual({ ok: false, status: 400 });
    expect(await stub.progress()).toEqual({ runId: "run-1", stage: null, count: null });
  });

  it("accepts the bounds 0 and 100000 and stores only integers", async () => {
    const stub = await lock("lock-bounds");
    expect(await stub.setStage("run-1", "searching", 0)).toMatchObject({ ok: true, changed: true });
    expect(await stub.progress()).toEqual({ runId: "run-1", stage: "searching", count: 0 });
    expect(await stub.setStage("run-1", "reading", 100000)).toMatchObject({ ok: true, changed: true });
    expect(await stub.progress()).toEqual({ runId: "run-1", stage: "reading", count: 100000 });
  });

  it("writing carries no count, and old stage names map onto it", async () => {
    const stub = await lock("lock-writing");
    expect(await stub.setStage("run-1", "writing", 3)).toEqual({ ok: false, status: 400 });
    for (const [index, legacy] of ["drafting", "checking_citations", "saving"].entries()) {
      const fresh = env.CONVERSATION.getByName(`lock-legacy-${index}`);
      await fresh.acquire("run-1");
      expect(await fresh.setStage("run-1", legacy)).toMatchObject({ ok: true, changed: true });
      expect(await fresh.progress()).toEqual({ runId: "run-1", stage: "writing", count: null });
    }
  });

  it("never goes backwards, repeats are read-only, unknown stages are 400", async () => {
    const stub = await lock("lock-monotonic");
    await stub.setStage("run-1", "searching", 9);
    await stub.setStage("run-1", "reading", 4);
    expect(await stub.setStage("run-1", "searching", 9)).toEqual({ ok: false, status: 409 });
    expect(await stub.setStage("run-1", "reading", 4)).toMatchObject({ ok: true, changed: false });
    await stub.setStage("run-1", "writing");
    expect(await stub.setStage("run-1", "reading", 4)).toEqual({ ok: false, status: 409 });
    expect(await stub.setStage("run-1", "done")).toEqual({ ok: false, status: 400 });
    expect(await stub.setStage("run-1", "failed")).toEqual({ ok: false, status: 400 });
    expect(await stub.setStage("run-other", "writing")).toEqual({ ok: false, status: 409 });
    expect(await stub.progress()).toEqual({ runId: "run-1", stage: "writing", count: null });
  });

  it("rehydrates the count after eviction and clears it when a new run takes the lock", async () => {
    const stub = await lock("lock-evict");
    await stub.setStage("run-1", "reading", 5);
    await evictDurableObject(stub);
    expect(await stub.progress()).toEqual({ runId: "run-1", stage: "reading", count: 5 });
    await stub.release("run-1");
    await stub.acquire("run-2");
    expect(await stub.progress()).toEqual({ runId: "run-2", stage: null, count: null });
  });
});

describe("progress route payload", () => {
  async function pendingFor(requestId: string, owner = "member-maya") {
    return createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: owner,
      requestId,
      question: "How does leave work?",
      now: 100,
    });
  }

  it("returns exactly the closed shapes, integers only", async () => {
    const pending = await pendingFor("req-prog-shapes");
    const stub = env.CONVERSATION.getByName(pending.conversationId);
    await stub.acquire(pending.assistantMessageId);

    await stub.setStage(pending.assistantMessageId, "searching", 12);
    let res = await call("/turns/req-prog-shapes/progress", cookies["member-maya"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ stage: "searching", readableDocuments: 12 });

    await stub.setStage(pending.assistantMessageId, "reading", 6);
    res = await call("/turns/req-prog-shapes/progress", cookies["member-maya"]);
    expect(await res.json()).toEqual({ stage: "reading", passages: 6 });

    await stub.setStage(pending.assistantMessageId, "writing");
    res = await call("/turns/req-prog-shapes/progress", cookies["member-maya"]);
    expect(await res.json()).toEqual({ stage: "writing" });
  });

  it("a legacy stage written by an old run reads as writing", async () => {
    const pending = await pendingFor("req-prog-legacy");
    const stub = env.CONVERSATION.getByName(pending.conversationId);
    await stub.acquire(pending.assistantMessageId);
    await stub.setStage(pending.assistantMessageId, "checking_citations");
    const res = await call("/turns/req-prog-legacy/progress", cookies["member-maya"]);
    expect(await res.json()).toEqual({ stage: "writing" });
  });

  it("before the lock reports a stage, searching carries the asker's readable count, never the corpus total", async () => {
    await pendingFor("req-prog-early-maya", "member-maya");
    await pendingFor("req-prog-early-priya", "member-priya");
    const maya = (await (await call("/turns/req-prog-early-maya/progress", cookies["member-maya"])).json()) as {
      stage: string;
      readableDocuments: number;
    };
    const priya = (await (await call("/turns/req-prog-early-priya/progress", cookies["member-priya"])).json()) as typeof maya;
    expect(maya.stage).toBe("searching");
    const whoamiMaya = (await (await call("/whoami", cookies["member-maya"])).json()) as { readableDocumentCount: number };
    const whoamiPriya = (await (await call("/whoami", cookies["member-priya"])).json()) as { readableDocumentCount: number };
    expect(maya.readableDocuments).toBe(whoamiMaya.readableDocumentCount);
    expect(priya.readableDocuments).toBe(whoamiPriya.readableDocumentCount);
    expect(maya.readableDocuments).toBe(
      await countReadableDocuments(env.CORPUS_DB, generationId, {
        userId: MAYA.id,
        roles: MAYA.roles,
        departments: MAYA.departments,
      }),
    );
    for (const count of [maya.readableDocuments, priya.readableDocuments]) {
      expect(count).toBeLessThan(CHAT_CORPUS_TOTAL);
    }
    expect(maya.readableDocuments).not.toBe(priya.readableDocuments);
  });

  it("a stale lock from another run reports searching with the count, not that run's stage", async () => {
    const pending = await pendingFor("req-prog-stale");
    const stub = env.CONVERSATION.getByName(pending.conversationId);
    await stub.acquire("m-stale-run");
    await stub.setStage("m-stale-run", "writing");
    const body = (await (await call("/turns/req-prog-stale/progress", cookies["member-maya"])).json()) as {
      stage: string;
      readableDocuments: number;
    };
    expect(body.stage).toBe("searching");
    expect(Number.isInteger(body.readableDocuments)).toBe(true);
  });

  it("another principal gets 404 for the same request id", async () => {
    await pendingFor("req-prog-foreign");
    expect((await call("/turns/req-prog-foreign/progress", cookies["member-priya"])).status).toBe(404);
  });
});

describe("a real turn", () => {
  const question = "How does leave work at Northwind?";

  async function run(principal: typeof MAYA, requestId: string, calls: Array<[string, number | undefined]>) {
    return executeTurn({
      operations: env.OPERATIONS_DB,
      corpus: env.CORPUS_DB,
      lockFor: recordingLock(calls),
      principal,
      question,
      requestId,
    });
  }

  it("reports searching(readable), reading(passages), writing in order, with the asker's counts", async () => {
    const mayaCalls: Array<[string, number | undefined]> = [];
    const mayaAnswer = await run(MAYA, "turn-prog-maya", mayaCalls);
    const priyaCalls: Array<[string, number | undefined]> = [];
    await run(PRIYA, "turn-prog-priya", priyaCalls);

    const readable = (principal: typeof MAYA) =>
      countReadableDocuments(env.CORPUS_DB, generationId, {
        userId: principal.id,
        roles: principal.roles,
        departments: principal.departments,
      });
    expect(mayaCalls.map(([stage]) => stage)).toEqual(["searching", "reading", "writing"]);
    expect(mayaCalls[0][1]).toBe(await readable(MAYA));
    expect(priyaCalls[0][1]).toBe(await readable(PRIYA));
    expect(mayaCalls[0][1]).toBeLessThan(CHAT_CORPUS_TOTAL);
    expect(mayaCalls[2][1]).toBeUndefined();

    const evidenceRows = (
      await env.OPERATIONS_DB.prepare(`SELECT COUNT(*) AS n FROM evidence_snapshots WHERE message_id = ?`)
        .bind(mayaAnswer.assistantMessageId!)
        .first<{ n: number }>()
    )!.n;
    expect(evidenceRows).toBeGreaterThan(0);
    expect(mayaCalls[1][1]).toBe(evidenceRows);
  });

  it("persists latency and passages once; a replay changes neither the row nor the response", async () => {
    const first = await run(MAYA, "turn-metrics-1", []);
    const row = async () =>
      env.OPERATIONS_DB.prepare(
        `SELECT latency_ms, passages_retrieved, content, completion_token FROM messages WHERE id = ?`,
      )
        .bind(first.assistantMessageId!)
        .first<{ latency_ms: number; passages_retrieved: number; content: string; completion_token: string }>();
    const stored = (await row())!;
    expect(Number.isInteger(stored.latency_ms)).toBe(true);
    expect(stored.latency_ms).toBeGreaterThanOrEqual(0);
    expect(stored.passages_retrieved).toBeGreaterThan(0);

    const replay = await run(MAYA, "turn-metrics-1", []);
    expect(replay).toEqual(first);
    expect(await row()).toEqual(stored);
  });

  it("does not store metrics on a cancelled turn", async () => {
    const calls: Array<[string, number | undefined]> = [];
    const lockFor = (conversationId: string) => ({
      ...recordingLock(calls)(conversationId),
      cancelled: async () => true,
    });
    await expect(
      executeTurn({
        operations: env.OPERATIONS_DB,
        corpus: env.CORPUS_DB,
        lockFor,
        principal: MAYA,
        question,
        requestId: "turn-metrics-cancel",
      }),
    ).rejects.toBeDefined();
    const failed = await env.OPERATIONS_DB.prepare(
      `SELECT status, error_code, latency_ms, passages_retrieved FROM messages WHERE request_id = 'turn-metrics-cancel'`,
    ).first();
    expect(failed).toEqual({
      status: "failed",
      error_code: "CANCELLED",
      latency_ms: null,
      passages_retrieved: null,
    });
  });
});
