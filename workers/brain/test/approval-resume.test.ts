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
  expireApproval,
  upsertApproval,
} from "../../../src/lib/store/agent-runs";
import { createPendingTurn } from "../../../src/lib/store/conversations";
import {
  commitApprovedResumeWrites,
  enqueueRecoverableApprovalResumes,
  listRecoverableApprovalResumes,
  parseApprovalResumeMessage,
  replayRecoverableApprovalResumes,
  resumeApprovedAgentRun,
} from "../src/approval-resume";
import worker from "../src";
import { seedPrincipals } from "./seed";

async function approvedRun(
  suffix: string,
  tool: "create_draft" | "mcp_create_ticket" = "create_draft",
  expiresAt = Date.now() + 60_000,
): Promise<{
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
      tool,
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
    tool,
    argumentFingerprint: argumentFingerprint({ title: "alpha" }),
    idempotencyKey: `resume-${suffix}`,
    expiresAt,
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

  it("reconstructs an approved mcp_create_ticket exactly once", async () => {
    const { runId, binding } = await approvedRun("mcp", "mcp_create_ticket");
    const first = createMessageBatch("useful-brain-approval-resume-development", [{
      id: "resume-msg-mcp-1",
      timestamp: new Date(),
      attempts: 1,
      body: { runId, idempotencyKey: binding.idempotencyKey },
    }]);
    const second = createMessageBatch("useful-brain-approval-resume-dlq-development", [{
      id: "resume-msg-mcp-2",
      timestamp: new Date(),
      attempts: 6,
      body: { runId, idempotencyKey: binding.idempotencyKey },
    }]);
    const ctx = createExecutionContext();
    await worker.queue(first, env, ctx);
    await worker.queue(second, env, ctx);
    expect((await getQueueResult(first, ctx)).explicitAcks).toEqual(["resume-msg-mcp-1"]);
    expect((await getQueueResult(second, ctx)).explicitAcks).toEqual(["resume-msg-mcp-2"]);
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
      tool: "mcp_create_ticket",
      normalized_arguments_json: '{"title":"alpha"}',
    });
    const run = await env.OPERATIONS_DB.prepare(
      "SELECT status FROM agent_runs WHERE id = ?",
    ).bind(runId).first<{ status: string }>();
    expect(run?.status).toBe("completed");
  });

  it("replays identifier-only recoverable approvals without repeating a completed effect", async () => {
    const { runId, binding } = await approvedRun("dlq");
    const listed = await listRecoverableApprovalResumes(env.OPERATIONS_DB);
    const mine = listed.find((message) => message.runId === runId);
    expect(mine).toEqual(parseApprovalResumeMessage({
      runId,
      idempotencyKey: binding.idempotencyKey,
    }));
    expect(Object.keys(mine ?? {})).toEqual(["runId", "idempotencyKey"]);
    const targeted: Array<{ runId: string; idempotencyKey: string }> = [];
    await replayRecoverableApprovalResumes(env.OPERATIONS_DB, async (message) => {
      if (message.runId === runId) {
        targeted.push(message);
      }
    });
    expect(targeted).toEqual([{ runId, idempotencyKey: binding.idempotencyKey }]);
    const batch = createMessageBatch("useful-brain-approval-resume-dlq-development", [{
      id: "resume-msg-dlq",
      timestamp: new Date(),
      attempts: 6,
      body: targeted[0],
    }]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env, ctx);
    expect((await getQueueResult(batch, ctx)).explicitAcks).toEqual(["resume-msg-dlq"]);
    const remaining = await listRecoverableApprovalResumes(env.OPERATIONS_DB);
    expect(remaining.some((message) => message.runId === runId)).toBe(false);
    const after: Array<{ runId: string }> = [];
    await replayRecoverableApprovalResumes(env.OPERATIONS_DB, async (message) => {
      if (message.runId === runId) {
        after.push(message);
      }
    });
    expect(after).toEqual([]);
    const effect = await env.OPERATIONS_DB.prepare(
      "SELECT COUNT(*) AS count FROM synthetic_mutating_effects WHERE idempotency_key = ?",
    ).bind(binding.idempotencyKey).first<{ count: number }>();
    expect(effect?.count).toBe(1);
  });

  it("re-enqueues identifier-only recoveries from the scheduled handler", async () => {
    const { runId, binding } = await approvedRun("sched");
    const sent: Array<{ runId: string; idempotencyKey: string }> = [];
    const enqueued = await enqueueRecoverableApprovalResumes(env.OPERATIONS_DB, {
      async send(message) {
        sent.push(message);
      },
    });
    expect(enqueued.enqueued).toBeGreaterThanOrEqual(1);
    expect(sent).toContainEqual({ runId, idempotencyKey: binding.idempotencyKey });
    for (const message of sent) {
      expect(Object.keys(message)).toEqual(["runId", "idempotencyKey"]);
    }
    const ctx = createExecutionContext();
    await worker.scheduled(
      { scheduledTime: Date.now(), cron: "*/5 * * * *", noRetry() {} },
      env,
      ctx,
    );
    const batch = createMessageBatch("useful-brain-approval-resume-development", [{
      id: "resume-msg-sched",
      timestamp: new Date(),
      attempts: 1,
      body: { runId, idempotencyKey: binding.idempotencyKey },
    }]);
    await worker.queue(batch, env, ctx);
    expect((await getQueueResult(batch, ctx)).explicitAcks).toEqual(["resume-msg-sched"]);
    const remaining = await listRecoverableApprovalResumes(env.OPERATIONS_DB);
    expect(remaining.some((message) => message.runId === runId)).toBe(false);
  });

  it("terminates an approved resume delivered after expiry without retrying", async () => {
    const expiresAt = Date.now() + 30_000;
    const { runId, binding } = await approvedRun("late", "create_draft", expiresAt);
    const first = await resumeApprovedAgentRun(
      env.OPERATIONS_DB,
      { runId, idempotencyKey: binding.idempotencyKey },
      expiresAt + 1,
    );
    expect(first).toEqual({ resumed: false, expired: true });
    const listed = await listRecoverableApprovalResumes(env.OPERATIONS_DB);
    expect(listed.some((message) => message.runId === runId)).toBe(false);
    const second = await resumeApprovedAgentRun(
      env.OPERATIONS_DB,
      { runId, idempotencyKey: binding.idempotencyKey },
      expiresAt + 2,
    );
    expect(second).toEqual({ resumed: false, expired: true });
    const batch = createMessageBatch("useful-brain-approval-resume-development", [{
      id: "resume-msg-late",
      timestamp: new Date(),
      attempts: 1,
      body: { runId, idempotencyKey: binding.idempotencyKey },
    }]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env, ctx);
    expect((await getQueueResult(batch, ctx)).explicitAcks).toEqual(["resume-msg-late"]);
    const effect = await env.OPERATIONS_DB.prepare(
      "SELECT COUNT(*) AS count FROM synthetic_mutating_effects WHERE idempotency_key = ?",
    ).bind(binding.idempotencyKey).first<{ count: number }>();
    expect(effect?.count).toBe(0);
    const run = await env.OPERATIONS_DB.prepare(
      "SELECT status FROM agent_runs WHERE id = ?",
    ).bind(runId).first<{ status: string }>();
    expect(run?.status).toBe("failed");
    const approval = await env.OPERATIONS_DB.prepare(
      "SELECT status FROM approvals WHERE idempotency_key = ?",
    ).bind(binding.idempotencyKey).first<{ status: string }>();
    expect(approval?.status).toBe("expired");
  });

  it("does not insert an effect when expiry commits before the resume write", async () => {
    const expiresAt = Date.now() + 45_000;
    const { runId, binding } = await approvedRun("race", "create_draft", expiresAt);
    const call = await env.OPERATIONS_DB.prepare(
      "SELECT id, tool FROM tool_calls WHERE run_id = ?",
    )
      .bind(runId)
      .first<{ id: string; tool: string }>();
    expect(call).toMatchObject({ tool: "create_draft" });
    await expireApproval(env.OPERATIONS_DB, {
      runId,
      storedBinding: binding,
      now: expiresAt + 1,
    });
    const result = await commitApprovedResumeWrites(env.OPERATIONS_DB, {
      runId,
      idempotencyKey: binding.idempotencyKey,
      tool: call!.tool,
      toolCallId: call!.id,
      args: { title: "alpha" },
      now: expiresAt - 1,
    });
    expect(result).toEqual({ resumed: false, expired: true });
    const effect = await env.OPERATIONS_DB.prepare(
      "SELECT COUNT(*) AS count FROM synthetic_mutating_effects WHERE idempotency_key = ?",
    )
      .bind(binding.idempotencyKey)
      .first<{ count: number }>();
    expect(effect?.count).toBe(0);
    const run = await env.OPERATIONS_DB.prepare("SELECT status FROM agent_runs WHERE id = ?")
      .bind(runId)
      .first<{ status: string }>();
    expect(run?.status).toBe("failed");
  });
});
