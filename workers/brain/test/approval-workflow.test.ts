import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("ApprovalWorkflow", () => {
  it("waits for an approval event, then rechecks the stored binding", async () => {
    const binding = {
      principalId: "principal-alice",
      conversationId: "c-1",
      tool: "create_draft",
      argumentFingerprint: '{"title":"alpha"}',
      idempotencyKey: "draft-alpha",
      expiresAt: Date.now() + 60_000,
    };
    await using instance = await introspectWorkflowInstance(env.APPROVAL_WORKFLOW, "approval-1");
    await instance.modify(async (m) => {
      await m.mockEvent({
        type: "approval",
        payload: { decision: "approve", binding },
      });
    });
    await env.APPROVAL_WORKFLOW.create({
      id: "approval-1",
      params: { binding },
    });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toEqual({
      resume: true,
      idempotencyKey: "draft-alpha",
    });
    expect(await instance.waitForStepResult({ name: "recheck-policy" })).toEqual({
      resume: true,
      idempotencyKey: "draft-alpha",
    });
  });

  it("does not resume when arguments were tampered", async () => {
    const stored = {
      principalId: "principal-alice",
      conversationId: "c-1",
      tool: "create_draft",
      argumentFingerprint: '{"title":"alpha"}',
      idempotencyKey: "draft-beta",
      expiresAt: Date.now() + 60_000,
    };
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
      params: { binding: stored },
    });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toEqual({
      resume: false,
      reason: "approval does not match stored binding",
    });
  });
});
