import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createBrainServiceRequest } from "../../../src/lib/cf/service-binding-identity";
import { createPendingTurn } from "../../../src/lib/store/conversations";
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

describe("Brain UI APIs", () => {
  it("cancels the caller's pending turn by request id", async () => {
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "turn-ui-cancel",
      question: "Stop this answer",
      now: 2,
    });
    const stub = env.CONVERSATION.getByName(pending.conversationId);
    expect(await stub.acquire(pending.assistantMessageId)).toMatchObject({ ok: true });

    const response = await authed("/cancel", {
      method: "POST",
      json: { requestId: "turn-ui-cancel" },
    });

    expect(response.status).toBe(200);
    expect(await stub.cancelled()).toBe(true);
    const stored = await env.OPERATIONS_DB.prepare(
      `SELECT status, error_code FROM messages WHERE id = ?`,
    )
      .bind(pending.assistantMessageId)
      .first<{ status: string; error_code: string }>();
    expect(stored).toEqual({ status: "failed", error_code: "CANCELLED" });
  });

  it("claims cancellation before the conversation lock is acquired", async () => {
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "turn-ui-cancel-before-lock",
      question: "Stop before the run starts",
      now: 3,
    });

    const response = await authed("/cancel", {
      method: "POST",
      json: { requestId: "turn-ui-cancel-before-lock" },
    });

    expect(response.status).toBe(200);
    const stored = await env.OPERATIONS_DB.prepare(
      `SELECT status, error_code FROM messages WHERE id = ?`,
    )
      .bind(pending.assistantMessageId)
      .first<{ status: string; error_code: string }>();
    expect(stored).toEqual({ status: "failed", error_code: "CANCELLED" });
  });

  it("persists a turn with insufficient evidence when no corpus is bound", async () => {
    const response = await authed("/turns", {
      method: "POST",
      json: { question: "What is the meaning of life?", requestId: "turn-ui-1" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      conversationId?: string;
      structuredAnswer: { answerType: string };
    };
    expect(body.structuredAnswer.answerType).toBe("insufficient_evidence");
    expect(body.conversationId).toMatch(/^c-/);

    const listed = await authed("/conversations");
    expect(listed.status).toBe(200);
    const conversations = (await listed.json()) as Array<{ id: string }>;
    expect(conversations.some((item) => item.id === body.conversationId)).toBe(true);

    const loaded = await authed(`/conversations/${body.conversationId}`);
    expect(loaded.status).toBe(200);
    const conversation = (await loaded.json()) as { turns: unknown[] };
    expect(conversation.turns.length).toBeGreaterThan(0);

    const deleted = await authed(`/conversations/${body.conversationId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const missing = await authed(`/conversations/${body.conversationId}`);
    expect(missing.status).toBe(403);
  });

  it("rejects an empty turn payload", async () => {
    const response = await authed("/turns", {
      method: "POST",
      json: { question: "   ", requestId: "turn-ui-empty" },
    });
    expect(response.status).toBe(400);
  });

  it("returns an empty knowledge inventory without CORPUS_DB", async () => {
    const response = await authed("/knowledge");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      documents: [],
      chunks: [],
      embeddingStorageStatus: { corpusStatus: "not_started" },
      retrievalMode: "keyword",
    });
  });

  it("rejects corpus re-indexing without a corpus database", async () => {
    const response = await authed("/knowledge/reindex", { method: "POST" });
    expect(response.status).toBe(400);
  });

  it("rejects corpus seed without a corpus database", async () => {
    const response = await authed("/knowledge/seed", {
      method: "POST",
      json: {
        documents: [
          {
            documentId: "nw-test",
            title: "Test",
            sourceName: "Test",
            sourcePath: "northwind/test.md",
            accessScope: "public",
            allowedRoles: [],
            allowedDepartments: [],
            body: "Hello.",
          },
        ],
      },
    });
    expect(response.status).toBe(400);
  });

  it("forbids corpus seed for a non-operator", async () => {
    await env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO principals (id, kind, subject, created_at) VALUES (?, ?, ?, ?)`,
    )
      .bind("principal-sam", "user", "sam@karkoai.com", 1)
      .run();
    await env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO roles (principal_id, role) VALUES (?, ?)`,
    )
      .bind("principal-sam", "standard")
      .run();
    const response = await authed("/knowledge/seed", {
      method: "POST",
      email: "sam@karkoai.com",
      json: {
        documents: [
          {
            documentId: "nw-test",
            title: "Test",
            sourceName: "Test",
            sourcePath: "northwind/test.md",
            accessScope: "public",
            allowedRoles: [],
            allowedDepartments: [],
            body: "Hello.",
          },
        ],
      },
    });
    expect(response.status).toBe(403);
  });

  it("lists evaluation runs as an empty array before any run", async () => {
    const response = await authed("/evaluations");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});
