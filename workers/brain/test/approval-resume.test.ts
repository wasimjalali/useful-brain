import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { argumentFingerprint, type ApprovalBinding } from "../../../src/lib/agent/policy";
import { PROMPT_VERSION } from "../../../src/lib/answer/contract";
import {
  completeAgentRun,
  createAgentRun,
  decideApproval,
  upsertApproval,
} from "../../../src/lib/store/agent-runs";
import { createPendingTurn } from "../../../src/lib/store/conversations";
import worker from "../src";
import { seedPrincipals } from "./seed";

async function approvedRun(suffix: string): Promise<{
  runId: string;
  binding: ApprovalBinding;
}> {
  await seedPrincipals();
  const pending = await createPendingTurn(env.OPERATIONS_DB, {
    ownerPrincipalId: "principal-alice",
    requestId: `req-resume-${suffix}`,
    question: "Create a durable draft",
    now: 200,
  });
  const runId = `run-resume-${suffix}`;
  await createAgentRun(env.OPERATIONS_DB, {
    runId,
    conversationId: pending.conversationId,
    principalId: "principal-alice",
    model: "phase5-faux",
    promptVersion: PROMPT_VERSION,
    corpusGenerationId: "gen-1",
    now: 201,
  });
  await completeAgentRun(env.OPERATIONS_DB, {
    runId,
    status: "pending_approval",
    toolCalls: [{
      tool: "create_draft",
      argumentFingerprint: argumentFingerprint({ title: "alpha" }),
      normalizedArguments: { title: "alpha" },
      redactedResult: "pending_approval",
      status: "pending_approval",
    }],
    now: 202,
  });
  const binding: ApprovalBinding = {
    principalId: "principal-alice",
    conversationId: pending.conversationId,
    tool: "create_draft",
    argumentFingerprint: argumentFingerprint({ title: "alpha" }),
    idempotencyKey: `resume-${suffix}`,
    expiresAt: Date.now() + 60_000,
  };
  await upsertApproval(env.OPERATIONS_DB, runId, binding, "pending", Date.now());
  expect(
    await decideApproval(env.OPERATIONS_DB, {
      runId,
      storedBinding: binding,
      eventBinding: binding,
      decision: "approve",
      now: Date.now(),
    }),
  ).toEqual({ resume: true, idempotencyKey: binding.idempotencyKey });
  return { runId, binding };
}

describe("approval resume queue", () => {
  it("reconstructs one exact approved effect and acks duplicate delivery", async () => {
    const { runId, binding } = await approvedRun("alpha");
    const first = createMessageBatch("useful-brain-approval-resume-development", [{
      id: "resume-msg-1",
      timestamp: new Date(),
      attempts: 1,
      body: { runId, idempotencyKey: binding.idempotencyKey },
    }]);
    const second = createMessageBatch("useful-brain-approval-resume-development", [{
      id: "resume-msg-2",
      timestamp: new Date(),
      attempts: 2,
      body: { runId, idempotencyKey: binding.idempotencyKey },
    }]);
    const ctx = createExecutionContext();

    await worker.queue(first, env, ctx);
    await worker.queue(second, env, ctx);

    expect((await getQueueResult(first, ctx)).explicitAcks).toEqual(["resume-msg-1"]);
    expect((await getQueueResult(second, ctx)).explicitAcks).toEqual(["resume-msg-2"]);
    const effect = await env.OPERATIONS_DB.prepare(
      `SELECT COUNT(*) AS count, tool, normalized_arguments_json
       FROM synthetic_mutating_effects WHERE idempotency_key = ?`,
    ).bind(binding.idempotencyKey).first<{
      count: number;
      tool: string;
      normalized_arguments_json: string;
    }>();
    expect(effect).toMatchObject({
      count: 1,
      tool: "create_draft",
      normalized_arguments_json: '{"title":"alpha"}',
    });
    const run = await env.OPERATIONS_DB.prepare(
      "SELECT status FROM agent_runs WHERE id = ?",
    ).bind(runId).first<{ status: string }>();
    expect(run?.status).toBe("completed");
  });

  it("retries without executing when the resume key was tampered", async () => {
    const { runId, binding } = await approvedRun("tampered");
    const batch = createMessageBatch("useful-brain-approval-resume-development", [{
      id: "resume-msg-tampered",
      timestamp: new Date(),
      attempts: 1,
      body: { runId, idempotencyKey: "resume-wrong" },
    }]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env, ctx);

    expect((await getQueueResult(batch, ctx)).retryMessages).toHaveLength(1);
    const effect = await env.OPERATIONS_DB.prepare(
      "SELECT COUNT(*) AS count FROM synthetic_mutating_effects WHERE idempotency_key = ?",
    ).bind(binding.idempotencyKey).first<{ count: number }>();
    expect(effect?.count).toBe(0);
  });
});
