import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { argumentFingerprint } from "../../../src/lib/agent/policy";
import { PROMPT_VERSION } from "../../../src/lib/answer/contract";
import {
  completeAgentRun,
  createAgentRun,
} from "../../../src/lib/store/agent-runs";
import { createPendingTurn } from "../../../src/lib/store/conversations";
import worker from "../src";
import { generateSigning, jwksResponse, signToken } from "./jwt";
import { seedPrincipals } from "./seed";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

let signing: Awaited<ReturnType<typeof generateSigning>>;
let originalFetch: typeof fetch;

beforeAll(async () => {
  signing = await generateSigning();
});

beforeEach(async () => {
  await seedPrincipals();
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/cdn-cgi/access/certs")) {
      return jwksResponse([signing.jwk]);
    }
    return originalFetch(input, init);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function fetchWorker(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function pendingRun(suffix: string): Promise<{ runId: string; conversationId: string }> {
  const pending = await createPendingTurn(env.OPERATIONS_DB, {
    ownerPrincipalId: "principal-alice",
    requestId: `req-start-${suffix}`,
    question: "Create a durable draft",
    now: 300,
  });
  const runId = `run-start-${suffix}`;
  await createAgentRun(env.OPERATIONS_DB, {
    runId,
    conversationId: pending.conversationId,
    principalId: "principal-alice",
    model: "phase5-faux",
    promptVersion: PROMPT_VERSION,
    corpusGenerationId: "gen-1",
    now: 301,
  });
  await completeAgentRun(env.OPERATIONS_DB, {
    runId,
    status: "pending_approval",
    toolCalls: [
      {
        tool: "create_draft",
        argumentFingerprint: argumentFingerprint({ title: "alpha" }),
        normalizedArguments: { title: "alpha" },
        redactedResult: "pending_approval",
        status: "pending_approval",
      },
    ],
    now: 302,
  });
  return { runId, conversationId: pending.conversationId };
}

describe("approval start binding", () => {
  it("ignores a client-substituted idempotency key and expiry", async () => {
    const token = await signToken(signing.privateKey, signing.kid);
    const { runId, conversationId } = await pendingRun("owned");
    const attackerExpiry = Date.now() + 1_000;
    const response = await fetchWorker(
      new IncomingRequest("https://brain.internal/approvals/start", {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": token,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          runId,
          binding: {
            principalId: "principal-alice",
            conversationId,
            tool: "create_draft",
            argumentFingerprint: argumentFingerprint({ title: "alpha" }),
            idempotencyKey: "attacker-key",
            expiresAt: attackerExpiry,
          },
        }),
      }),
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      workflowId: string;
      binding: { idempotencyKey: string; expiresAt: number };
    };
    expect(body.binding.idempotencyKey).not.toBe("attacker-key");
    expect(body.binding.expiresAt).toBeGreaterThan(attackerExpiry);
    const stored = await env.OPERATIONS_DB.prepare(
      "SELECT idempotency_key, expires_at FROM approvals WHERE run_id = ?",
    )
      .bind(runId)
      .first<{ idempotency_key: string; expires_at: number }>();
    expect(stored?.idempotency_key).toBe(body.binding.idempotencyKey);
    expect(stored?.expires_at).toBe(body.binding.expiresAt);
  });

  it("rejects a client binding that does not match the pending tool call", async () => {
    const token = await signToken(signing.privateKey, signing.kid);
    const { runId, conversationId } = await pendingRun("mismatch");
    const response = await fetchWorker(
      new IncomingRequest("https://brain.internal/approvals/start", {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": token,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          runId,
          binding: {
            principalId: "principal-alice",
            conversationId,
            tool: "create_draft",
            argumentFingerprint: argumentFingerprint({ title: "tampered" }),
            idempotencyKey: "attacker-key",
            expiresAt: Date.now() + 60_000,
          },
        }),
      }),
    );
    expect(response.status).toBe(400);
    const stored = await env.OPERATIONS_DB.prepare(
      "SELECT COUNT(*) AS count FROM approvals WHERE run_id = ?",
    )
      .bind(runId)
      .first<{ count: number }>();
    expect(stored?.count).toBe(0);
  });

  it("returns one persisted binding for concurrent starts of the same run", async () => {
    const token = await signToken(signing.privateKey, signing.kid);
    const { runId } = await pendingRun("concurrent");
    const start = () =>
      fetchWorker(
        new IncomingRequest("https://brain.internal/approvals/start", {
          method: "POST",
          headers: {
            "cf-access-jwt-assertion": token,
            "content-type": "application/json",
          },
          body: JSON.stringify({ runId }),
        }),
      );
    const responses = await Promise.all([start(), start()]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    const bodies = await Promise.all(
      responses.map(
        (response) =>
          response.json() as Promise<{
            workflowId: string;
            binding: { idempotencyKey: string; expiresAt: number };
          }>,
      ),
    );
    expect(bodies[0].binding.idempotencyKey).toBe(bodies[1].binding.idempotencyKey);
    expect(bodies[0].binding.expiresAt).toBe(bodies[1].binding.expiresAt);
    expect(bodies[0].workflowId).toBe(bodies[1].workflowId);
    const stored = await env.OPERATIONS_DB.prepare(
      "SELECT COUNT(*) AS count, MIN(expires_at) AS expires_at FROM approvals WHERE run_id = ?",
    )
      .bind(runId)
      .first<{ count: number; expires_at: number }>();
    expect(stored?.count).toBe(1);
    expect(stored?.expires_at).toBe(bodies[0].binding.expiresAt);
  });
});
