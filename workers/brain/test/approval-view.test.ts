import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { argumentFingerprint } from "../../../src/lib/agent/policy";
import { decideApproval } from "../../../src/lib/store/agent-runs";
import { loadApprovalViewForMessage } from "../../../src/lib/store/approval-view";
import { commitApprovedResumeWrites } from "../src/approval-resume";
import { pendingTicketRun, TICKET_ARGS } from "./ticket-helpers";

describe("approval view", () => {
  it("shows the stored arguments while pending", async () => {
    const { assistantMessageId, runId } = await pendingTicketRun("view-pending");
    const view = await loadApprovalViewForMessage(env.OPERATIONS_DB, assistantMessageId, { id: "principal-alice" });
    expect(view).toMatchObject({
      runId,
      state: "pending",
      tool: "create_ticket",
      arguments: TICKET_ARGS,
    });
    expect(view?.ticket).toBeUndefined();
    const stored = await env.OPERATIONS_DB.prepare(
      "SELECT normalized_arguments_json FROM tool_calls WHERE run_id = ?",
    ).bind(runId).first<{ normalized_arguments_json: string }>();
    expect(JSON.parse(stored?.normalized_arguments_json ?? "null")).toEqual(view?.arguments);
  });

  it("returns null for a non-owner and for unknown messages", async () => {
    const { assistantMessageId } = await pendingTicketRun("view-owner");
    expect(await loadApprovalViewForMessage(env.OPERATIONS_DB, assistantMessageId, { id: "principal-dev" })).toBeNull();
    expect(await loadApprovalViewForMessage(env.OPERATIONS_DB, "msg-missing", { id: "principal-alice" })).toBeNull();
  });

  it("reads expired when pending past the expiry", async () => {
    const now = Date.now();
    const { assistantMessageId, binding } = await pendingTicketRun("view-expired", TICKET_ARGS, {
      now,
      expiresInMs: 60_000,
    });
    const view = await loadApprovalViewForMessage(
      env.OPERATIONS_DB,
      assistantMessageId,
      { id: "principal-alice" },
      binding.expiresAt + 1,
    );
    expect(view?.state).toBe("expired");
  });

  it("reads denied after a rejection", async () => {
    const { assistantMessageId, runId, binding } = await pendingTicketRun("view-denied");
    await decideApproval(env.OPERATIONS_DB, {
      runId,
      storedBinding: binding,
      eventBinding: binding,
      decision: "reject",
      now: Date.now(),
    });
    const view = await loadApprovalViewForMessage(env.OPERATIONS_DB, assistantMessageId, { id: "principal-alice" });
    expect(view?.state).toBe("denied");
  });

  it("reads approved with the ticket id after the durable resume", async () => {
    const { assistantMessageId, runId, binding } = await pendingTicketRun("view-approved");
    await decideApproval(env.OPERATIONS_DB, {
      runId,
      storedBinding: binding,
      eventBinding: binding,
      decision: "approve",
      now: Date.now(),
    });
    const call = await env.OPERATIONS_DB.prepare("SELECT id FROM tool_calls WHERE run_id = ?")
      .bind(runId).first<{ id: string }>();
    await commitApprovedResumeWrites(env.OPERATIONS_DB, {
      runId,
      idempotencyKey: binding.idempotencyKey,
      tool: "create_ticket",
      toolCallId: call?.id ?? "",
      args: TICKET_ARGS,
      now: Date.now(),
    });
    const view = await loadApprovalViewForMessage(env.OPERATIONS_DB, assistantMessageId, { id: "principal-alice" });
    expect(view?.state).toBe("approved");
    expect(view?.ticket?.id).toMatch(/^SUP-\d+$/);
    expect(view?.ticket?.createdAt).toBeGreaterThan(0);
  });

  it("redacts secrets in display copy but keeps tool_calls exact", async () => {
    const secretArgs = { ...TICKET_ARGS, subject: "Login fails, token: sk-live-123456" };
    const { assistantMessageId, runId } = await pendingTicketRun("view-redact", secretArgs);
    const view = await loadApprovalViewForMessage(env.OPERATIONS_DB, assistantMessageId, { id: "principal-alice" });
    expect(JSON.stringify(view)).not.toContain("sk-live-123456");
    expect(view?.arguments.subject).toContain("[REDACTED]");
    const display = await env.OPERATIONS_DB.prepare(
      "SELECT display_arguments_json FROM approvals WHERE run_id = ?",
    ).bind(runId).first<{ display_arguments_json: string }>();
    expect(display?.display_arguments_json).not.toContain("sk-live-123456");
    const call = await env.OPERATIONS_DB.prepare(
      "SELECT argument_fingerprint, normalized_arguments_json FROM tool_calls WHERE run_id = ?",
    ).bind(runId).first<{ argument_fingerprint: string; normalized_arguments_json: string }>();
    expect(call?.normalized_arguments_json).toContain("sk-live-123456");
    expect(call?.argument_fingerprint).toBe(argumentFingerprint(secretArgs));
  });
});
