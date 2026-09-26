import { createExecutionContext, evictDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { addCitationLabels, PROMPT_VERSION } from "../../../src/lib/answer/contract";
import { createBrainServiceRequest } from "../../../src/lib/cf/service-binding-identity";
import {
  completeTurn,
  createPendingTurn,
  failTurn,
} from "../../../src/lib/store/conversations";
import worker from "../src";
import { generateSigning, jwksResponse, signToken } from "./jwt";
import { seedPrincipals } from "./seed";

let originalFetch: typeof fetch;
let signing: Awaited<ReturnType<typeof generateSigning>>;

beforeAll(async () => {
  signing = await generateSigning();
});

beforeEach(async () => {
  await seedPrincipals();
  originalFetch = globalThis.fetch;
  mockJwks([signing.jwk]);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockJwks(keys: object[]): void {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/cdn-cgi/access/certs")) {
      return jwksResponse(keys);
    }
    return originalFetch(input, init);
  };
}

async function fetchWorker(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function authed(
  path: string,
  init: { method?: string; json?: unknown; email?: string } = {},
): Promise<Response> {
  const token = await signToken(signing.privateKey, signing.kid, {
    email: init.email ?? "alice@karkoai.com",
  });
  const body = init.json === undefined ? null : JSON.stringify(init.json);
  return fetchWorker(
    createBrainServiceRequest({
      incomingHeaders: new Headers({ "cf-access-jwt-assertion": token }),
      path,
      method: init.method ?? (body ? "POST" : "GET"),
      body,
    }),
  );
}

async function completePendingTurn(
  pending: { assistantMessageId: string },
  requestId: string,
  now: number,
) {
  return completeTurn(env.OPERATIONS_DB, {
    ownerPrincipalId: "principal-alice",
    assistantMessageId: pending.assistantMessageId,
    requestId,
    rawModelJson: JSON.stringify({
      answerType: "grounded",
      paragraphs: [{ text: "Leave accrues monthly.", citations: ["[1]"] }],
    }),
    evidence: addCitationLabels([
      {
        rank: 1,
        score: 0.8,
        chunkId: "leave__chunk_001",
        source: "leave.md",
        section: "Accrual",
        text: "Leave accrues monthly.",
        tokenEstimate: 4,
      },
    ]),
    answerModel: "test-model",
    embeddingModel: "fake-embed",
    embeddingDimensions: 8,
    promptVersion: PROMPT_VERSION,
    retrievalConfigVersion: "fake-provider",
    corpusGenerationId: "gen-1",
    now,
  });
}

describe("conversation lock turn stages", () => {
  it("records stages for the owning run only and stays monotonic", async () => {
    const stub = env.CONVERSATION.getByName("conv-stage-owner");
    expect(await stub.acquire("run-progress")).toEqual({ ok: true, runId: "run-progress" });

    expect(await stub.setStage("run-progress", "searching")).toEqual({
      ok: true,
      runId: "run-progress",
      changed: true,
    });
    expect(await stub.progress()).toEqual({ runId: "run-progress", stage: "searching" });

    // A repeated mark is accepted without a storage write.
    expect(await stub.setStage("run-progress", "searching")).toEqual({
      ok: true,
      runId: "run-progress",
      changed: false,
    });

    expect(await stub.setStage("run-progress", "drafting")).toEqual({
      ok: true,
      runId: "run-progress",
      changed: true,
    });

    // Backward movement and writes from a stale run are rejected.
    expect(await stub.setStage("run-progress", "searching")).toEqual({ ok: false, status: 409 });
    expect(await stub.setStage("run-other", "saving")).toEqual({ ok: false, status: 409 });
    expect(await stub.progress()).toEqual({ runId: "run-progress", stage: "drafting" });
  });

  it("rejects unknown stages and unbounded run ids", async () => {
    const stub = env.CONVERSATION.getByName("conv-stage-invalid");
    expect(await stub.acquire("run-progress")).toEqual({ ok: true, runId: "run-progress" });
    expect(await stub.setStage("run-progress", "done")).toEqual({ ok: false, status: 400 });
    expect(await stub.setStage("run-progress", "summarizing")).toEqual({ ok: false, status: 400 });
    expect(await stub.setStage("../run", "searching")).toEqual({ ok: false, status: 400 });
    expect(await stub.progress()).toEqual({ runId: "run-progress", stage: null });
  });

  it("rejects stage writes after release and rehydrates across eviction", async () => {
    const stub = env.CONVERSATION.getByName("conv-stage-restart");
    expect(await stub.acquire("run-progress")).toEqual({ ok: true, runId: "run-progress" });
    await stub.setStage("run-progress", "checking_citations");

    await evictDurableObject(stub);
    expect(await stub.progress()).toEqual({
      runId: "run-progress",
      stage: "checking_citations",
    });

    expect(await stub.release("run-progress")).toEqual({ ok: true, runId: "run-progress" });
    expect(await stub.progress()).toEqual({ runId: null, stage: null });
    expect(await stub.setStage("run-progress", "saving")).toEqual({ ok: false, status: 409 });
  });

  it("resets the stage when a new run takes the lock", async () => {
    const stub = env.CONVERSATION.getByName("conv-stage-reset");
    await stub.acquire("run-first");
    await stub.setStage("run-first", "drafting");
    await stub.release("run-first");

    await stub.acquire("run-second");
    expect(await stub.progress()).toEqual({ runId: "run-second", stage: null });
  });
});

describe("turn progress route", () => {
  it("requires an authenticated principal", async () => {
    const response = await fetchWorker(
      createBrainServiceRequest({
        incomingHeaders: new Headers(),
        path: "/turns/req-unauthenticated/progress",
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("returns 404 for an unknown request id", async () => {
    const response = await authed("/turns/req-unknown-progress/progress");
    expect(response.status).toBe(404);
  });

  it("returns 404 for a request id owned by another principal even when the claim row exists", async () => {
    await env.OPERATIONS_DB.batch([
      env.OPERATIONS_DB.prepare(
        `INSERT OR IGNORE INTO principals (id, kind, subject, created_at) VALUES (?, ?, ?, ?)`,
      ).bind("principal-bob", "user", "bob@karkoai.com", 1),
      env.OPERATIONS_DB.prepare(
        `INSERT OR IGNORE INTO roles (principal_id, role) VALUES (?, ?)`,
      ).bind("principal-bob", "standard"),
    ]);
    // The staged insert makes the claim owner (alice) and the conversation
    // owner (bob) deliberately different principals: proving the
    // conversation-owner join is a real deciding predicate, not defence in
    // depth that could be removed without failing this test.
    await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-cross-owner",
      question: "Private question",
      now: 10,
    });
    await env.OPERATIONS_DB.prepare(
      `UPDATE conversations SET owner_principal_id = 'principal-bob'
       WHERE id = (SELECT conversation_id FROM request_id_claims WHERE request_id = 'req-cross-owner')`,
    ).run();

    const response = await authed("/turns/req-cross-owner/progress", {
      email: "bob@karkoai.com",
    });
    expect(response.status).toBe(404);
    // And the conversation owner herself gets 404 too: the claim row still
    // names alice as the claim owner, so neither principal passes both joins.
    const asAlice = await authed("/turns/req-cross-owner/progress");
    expect(asAlice.status).toBe(404);
  });

  it("reports the lock stage for the owning pending run", async () => {
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-live-stage",
      question: "What is the refund window?",
      now: 20,
    });
    const stub = env.CONVERSATION.getByName(pending.conversationId);
    await stub.acquire(pending.assistantMessageId);
    await stub.setStage(pending.assistantMessageId, "searching");
    await stub.setStage(pending.assistantMessageId, "drafting");

    const response = await authed("/turns/req-live-stage/progress");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ stage: "drafting" });
  });

  it("reports the earliest stage when no lock row exists yet", async () => {
    await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-not-started",
      question: "What is the refund window?",
      now: 30,
    });

    const response = await authed("/turns/req-not-started/progress");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stage: "searching" });
  });

  it("reports the earliest stage when the lock belongs to another run", async () => {
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-stale-lock",
      question: "What is the refund window?",
      now: 40,
    });
    const stub = env.CONVERSATION.getByName(pending.conversationId);
    await stub.acquire("m-stale-run");
    await stub.setStage("m-stale-run", "saving");

    const response = await authed("/turns/req-stale-lock/progress");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stage: "searching" });
  });

  it("reports the D1 terminal snapshot for a completed turn", async () => {
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-done",
      question: "Leave policy?",
      now: 50,
    });
    await completePendingTurn(pending, "req-done", 51);

    const response = await authed("/turns/req-done/progress");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stage: "done" });
  });

  it("reports stored failure codes for failed turns", async () => {
    for (const [requestId, errorCode] of [
      ["req-failed-cancelled", "CANCELLED"],
      ["req-failed-rate", "RATE_LIMITED"],
      ["req-failed-internal", "INTERNAL_ERROR"],
    ] as const) {
      const pending = await createPendingTurn(env.OPERATIONS_DB, {
        ownerPrincipalId: "principal-alice",
        requestId,
        question: "Private question",
        now: 60,
      });
      await failTurn(env.OPERATIONS_DB, {
        assistantMessageId: pending.assistantMessageId,
        ownerPrincipalId: "principal-alice",
        errorCode,
        now: 61,
      });
      const response = await authed(`/turns/${requestId}/progress`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ stage: "failed", errorCode });
    }
  });
});
