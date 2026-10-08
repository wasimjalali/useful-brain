import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { decideApproval } from "../../../src/lib/store/agent-runs";
import { loadTicketByKey } from "../../../src/lib/store/tickets";
import { resumeApprovedAgentRun } from "../src/approval-resume";
import worker from "../src";
import { pendingTicketRun, TICKET_ARGS } from "./ticket-helpers";

async function approve(suffix: string, args = TICKET_ARGS) {
  const run = await pendingTicketRun(suffix, args);
  const decided = await decideApproval(env.OPERATIONS_DB, {
    runId: run.runId,
    storedBinding: run.binding,
    eventBinding: run.binding,
    decision: "approve",
    now: Date.now(),
  });
  expect(decided).toEqual({ resume: true, idempotencyKey: run.binding.idempotencyKey });
  return run;
}

async function deliver(runId: string, idempotencyKey: string, id: string, attempts = 1) {
  const batch = createMessageBatch("useful-brain-approval-resume-development", [{
    id,
    timestamp: new Date(),
    attempts,
    body: { runId, idempotencyKey },
  }]);
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  return getQueueResult(batch, ctx);
}

describe("create_ticket durable resume", () => {
  it("creates SUP-4800 once for a double approve and a replayed queue message", async () => {
    const run = await approve("first");
    // Second approve of the same pending approval is idempotent.
    await decideApproval(env.OPERATIONS_DB, {
      runId: run.runId,
      storedBinding: run.binding,
      eventBinding: run.binding,
      decision: "approve",
      now: Date.now(),
    });
    expect((await deliver(run.runId, run.binding.idempotencyKey, "tk-1a")).explicitAcks).toEqual(["tk-1a"]);
    expect((await deliver(run.runId, run.binding.idempotencyKey, "tk-1b", 2)).explicitAcks).toEqual(["tk-1b"]);
    const count = await env.OPERATIONS_DB.prepare("SELECT COUNT(*) AS n FROM tickets").first<{ n: number }>();
    expect(count?.n).toBe(1);
    const ticket = await loadTicketByKey(env.OPERATIONS_DB, run.binding.idempotencyKey);
    expect(ticket).toMatchObject({
      id: "SUP-4800",
      desk: "Support",
      priority: "P1",
      customer: "Acme Logistics",
      subject: "Refund stuck after chargeback",
      runId: run.runId,
      principalId: "principal-alice",
    });
    const call = await env.OPERATIONS_DB.prepare(
      "SELECT redacted_result FROM tool_calls WHERE run_id = ?",
    ).bind(run.runId).first<{ redacted_result: string }>();
    expect(JSON.parse(call?.redacted_result ?? "null")).toMatchObject({ tool: "create_ticket", ticketId: "SUP-4800" });
    const effect = await env.OPERATIONS_DB.prepare(
      "SELECT result_json FROM idempotent_effects WHERE idempotency_key = ?",
    ).bind(run.binding.idempotencyKey).first<{ result_json: string }>();
    expect(JSON.parse(effect?.result_json ?? "null")).toMatchObject({ ticketId: "SUP-4800" });
  });

  it("numbers the next ticket SUP-4801 and both survive a fresh load", async () => {
    const run = await approve("second", { ...TICKET_ARGS, priority: "P2", customer: "Globex" });
    await deliver(run.runId, run.binding.idempotencyKey, "tk-2a");
    const rows = await env.OPERATIONS_DB.prepare("SELECT seq FROM tickets ORDER BY seq").all<{ seq: number }>();
    expect(rows.results.map((row) => row.seq)).toEqual([4800, 4801]);
    const fresh = await loadTicketByKey(env.OPERATIONS_DB, run.binding.idempotencyKey);
    expect(fresh?.id).toBe("SUP-4801");
  });

  it("does not create a ticket when the run was never approved", async () => {
    const run = await pendingTicketRun("unapproved");
    await expect(
      resumeApprovedAgentRun(env.OPERATIONS_DB, { runId: run.runId, idempotencyKey: run.binding.idempotencyKey }),
    ).rejects.toThrow();
    expect(await loadTicketByKey(env.OPERATIONS_DB, run.binding.idempotencyKey)).toBeNull();
  });

  it("refuses to resume when stored arguments were tampered", async () => {
    const run = await approve("tamper");
    await env.OPERATIONS_DB.prepare(
      "UPDATE tool_calls SET normalized_arguments_json = ? WHERE run_id = ?",
    ).bind(JSON.stringify({ ...TICKET_ARGS, customer: "Mallory Corp" }), run.runId).run();
    await expect(
      resumeApprovedAgentRun(env.OPERATIONS_DB, { runId: run.runId, idempotencyKey: run.binding.idempotencyKey }),
    ).rejects.toThrow();
    expect(await loadTicketByKey(env.OPERATIONS_DB, run.binding.idempotencyKey)).toBeNull();
  });

  it("refuses stored arguments that fail the create_ticket schema", async () => {
    const bad = { ...TICKET_ARGS, desk: "Sales" };
    const run = await approve("schema");
    await env.OPERATIONS_DB.prepare(
      "UPDATE tool_calls SET normalized_arguments_json = ?, argument_fingerprint = ? WHERE run_id = ?",
    ).bind(JSON.stringify(bad), "x", run.runId).run();
    await expect(
      resumeApprovedAgentRun(env.OPERATIONS_DB, { runId: run.runId, idempotencyKey: run.binding.idempotencyKey }),
    ).rejects.toThrow();
  });

  it("does not create a ticket after the approval expired", async () => {
    const run = await approve("late");
    const result = await resumeApprovedAgentRun(
      env.OPERATIONS_DB,
      { runId: run.runId, idempotencyKey: run.binding.idempotencyKey },
      run.binding.expiresAt + 1,
    );
    expect(result).toEqual({ resumed: false, expired: true });
    expect(await loadTicketByKey(env.OPERATIONS_DB, run.binding.idempotencyKey)).toBeNull();
  });
});
