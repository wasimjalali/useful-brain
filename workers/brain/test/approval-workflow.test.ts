import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { argumentFingerprint, type ApprovalBinding } from "../../../src/lib/agent/policy";
import { PROMPT_VERSION } from "../../../src/lib/answer/contract";
import {
  completeAgentRun,
  createAgentRun,
  upsertApproval,
} from "../../../src/lib/store/agent-runs";
import { createPendingTurn } from "../../../src/lib/store/conversations";
import { seedPrincipals } from "./seed";

async function seedPendingApproval(suffix: string): Promise<{
  runId: string;
  binding: ApprovalBinding;
}> {
  await seedPrincipals();
  const pending = await createPendingTurn(env.OPERATIONS_DB, {
    ownerPrincipalId: "principal-alice",
    requestId: `req-approval-${suffix}`,
    question: "Create a draft",
    now: 100,
  });
  const runId = `run-approval-${suffix}`;
  await createAgentRun(env.OPERATIONS_DB, {
    runId,
    conversationId: pending.conversationId,
    principalId: "principal-alice",
    model: "phase5-faux",
    promptVersion: PROMPT_VERSION,
    corpusGenerationId: "gen-1",
    now: 101,
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
    now: 102,
  });
  const binding: ApprovalBinding = {
    principalId: "principal-alice",
    conversationId: pending.conversationId,
    tool: "create_draft",
    argumentFingerprint: argumentFingerprint({ title: "alpha" }),
    idempotencyKey: `draft-${suffix}`,
    expiresAt: Date.now() + 60_000,
  };
  await upsertApproval(env.OPERATIONS_DB, runId, binding, "pending", Date.now());
  return { runId, binding };
}

describe("ApprovalWorkflow", () => {
  it("waits for an approval event, then rechecks the stored binding", async () => {
    const { runId, binding } = await seedPendingApproval("alpha");
    await using instance = await introspectWorkflowInstance(env.APPROVAL_WORKFLOW, "approval-1");
    await instance.modify(async (m) => {
      await m.mockEvent({
        type: "approval",
        payload: { decision: "approve", binding },
      });
    });
    await env.APPROVAL_WORKFLOW.create({
      id: "approval-1",
      params: { runId, binding },
    });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toEqual({
      resume: true,
      idempotencyKey: "draft-alpha",
      runId,
    });
    expect(await instance.waitForStepResult({ name: "persist-decision" })).toEqual({
      resume: true,
      idempotencyKey: "draft-alpha",
    });
    expect(await instance.waitForStepResult({ name: "enqueue-resume" })).toBeUndefined();
    const stored = await env.OPERATIONS_DB.prepare(
      "SELECT status FROM approvals WHERE idempotency_key = ?",
    ).bind("draft-alpha").first<{ status: string }>();
    expect(stored?.status).toBe("approved");
  });

  it("does not resume when arguments were tampered", async () => {
    const { runId, binding: stored } = await seedPendingApproval("beta");
    await using instance = await introspectWorkflowInstance(env.APPROVAL_WORKFLOW, "approval-2");
    await instance.modify(async (m) => {
      await m.mockEvent({
        type: "approval",
        payload: {
          decision: "approve",
          binding: { ...stored, argumentFingerprint: '{"title":"tampered"}' },
        },
      });
    });
    await env.APPROVAL_WORKFLOW.create({
      id: "approval-2",
      params: { runId, binding: stored },
    });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toEqual({
      resume: false,
      reason: "approval does not match stored binding",
    });
  });

  it("terminally expires the approval when the event wait times out", async () => {
    const { runId, binding } = await seedPendingApproval("timeout");
    await using instance = await introspectWorkflowInstance(env.APPROVAL_WORKFLOW, "approval-timeout");
    await instance.modify(async (m) => {
      await m.forceEventTimeout({ name: "wait-for-approval" });
    });
    await env.APPROVAL_WORKFLOW.create({
      id: "approval-timeout",
      params: { runId, binding },
    });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toEqual({ resume: false, reason: "expired" });
    const stored = await env.OPERATIONS_DB.prepare(
      "SELECT status FROM approvals WHERE run_id = ?",
    ).bind(runId).first<{ status: string }>();
    const run = await env.OPERATIONS_DB.prepare(
      "SELECT status FROM agent_runs WHERE id = ?",
    ).bind(runId).first<{ status: string }>();
    expect(stored?.status).toBe("expired");
    expect(run?.status).toBe("failed");
  });
});
