import { parseBoundedId, parseMutatingIdempotencyKey } from "../../../src/lib/cf/bounded-id";
import { argumentFingerprint, policyGateway } from "../../../src/lib/agent/policy";
import { loadAgentReplay } from "../../../src/lib/store/agent-runs";
import type { OperationsDatabase } from "../../../src/lib/store/conversations";

export type ApprovalResumeMessage = {
  runId: string;
  idempotencyKey: string;
};

export function parseApprovalResumeMessage(value: unknown): ApprovalResumeMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("approval resume message is invalid");
  }
  const message = value as Record<string, unknown>;
  if (
    Object.keys(message).length !== 2 ||
    typeof message.runId !== "string" ||
    typeof message.idempotencyKey !== "string"
  ) {
    throw new Error("approval resume message must contain identifiers only");
  }
  return {
    runId: parseBoundedId(message.runId, "run id"),
    idempotencyKey: parseMutatingIdempotencyKey(message.idempotencyKey),
  };
}

const DURABLE_RESUME_TOOLS = new Set(["create_draft", "action_sink_write", "mcp_create_ticket"]);

function assertSupportedArguments(tool: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("approved tool arguments are invalid");
  }
  const args = value as Record<string, unknown>;
  if (
    !DURABLE_RESUME_TOOLS.has(tool) ||
    Object.keys(args).length !== 1 ||
    typeof args.title !== "string" ||
    args.title.length === 0
  ) {
    throw new Error("approved tool is not supported by the durable resume dispatcher");
  }
  return args;
}

export async function resumeApprovedAgentRun(
  db: OperationsDatabase,
  payload: ApprovalResumeMessage,
  now = Date.now(),
): Promise<{ resumed: boolean; duplicate?: boolean }> {
  const { runId, idempotencyKey } = parseApprovalResumeMessage(payload);
  const run = await loadAgentReplay(db, runId);
  if (!run) {
    throw new Error("approved agent run was not found");
  }
  if (run.status === "completed") {
    if (run.approval?.idempotencyKey !== idempotencyKey) {
      throw new Error("completed run does not match the resume key");
    }
    return { resumed: false, duplicate: true };
  }
  if (run.status !== "pending_approval" || !run.approval) {
    throw new Error("agent run is not pending an approval");
  }
  if (
    run.approval.runId !== runId ||
    run.approval.status !== "approved" ||
    run.approval.idempotencyKey !== idempotencyKey
  ) {
    throw new Error("approval is not valid for this run");
  }
  const pendingCalls = run.toolCalls.filter((call) => call.status === "pending_approval");
  if (pendingCalls.length !== 1) {
    throw new Error("agent run must have exactly one pending tool call");
  }
  const call = pendingCalls[0];
  const args = assertSupportedArguments(call.tool, call.normalizedArguments);
  if (
    call.tool !== run.approval.tool ||
    call.argumentFingerprint !== run.approval.argumentFingerprint ||
    argumentFingerprint(args) !== run.approval.argumentFingerprint
  ) {
    throw new Error("pending tool call does not match its approval");
  }
  const policy = policyGateway({
    tool: call.tool,
    principal: { id: run.principalId },
    conversationId: run.conversationId,
    args,
    idempotencyKey,
    now,
    approval: run.approval,
  });
  if (policy.action !== "allow") {
    throw new Error(policy.action === "deny" ? policy.reason : "approval is still pending");
  }

  const resultJson = JSON.stringify({ resumed: true, tool: call.tool });
  await db.batch([
    db
      .prepare(
        `INSERT INTO synthetic_mutating_effects (
           idempotency_key, tool, normalized_arguments_json, created_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .bind(idempotencyKey, call.tool, JSON.stringify(args), now),
    db
      .prepare(
        `INSERT INTO idempotent_effects (
           idempotency_key, status, result_json, created_at, updated_at
         ) VALUES (?, 'completed', ?, ?, ?)
         ON CONFLICT(idempotency_key) DO UPDATE SET
           status = 'completed', result_json = excluded.result_json,
           updated_at = excluded.updated_at`,
      )
      .bind(idempotencyKey, resultJson, now, now),
    db
      .prepare(
        `UPDATE tool_calls SET status = 'ok', redacted_result = ?
         WHERE id = ? AND run_id = ? AND status = 'pending_approval'`,
      )
      .bind(resultJson, call.id, runId),
    db
      .prepare(
        `UPDATE agent_runs SET status = 'completed', updated_at = ?
         WHERE id = ? AND status = 'pending_approval'`,
      )
      .bind(now, runId),
  ]);
  return { resumed: true };
}

export async function listRecoverableApprovalResumes(
  db: OperationsDatabase,
  limit = 20,
): Promise<ApprovalResumeMessage[]> {
  const bounded = Math.max(1, Math.min(limit, 20));
  const rows = await db
    .prepare(
      `SELECT a.run_id AS run_id, a.idempotency_key AS idempotency_key
       FROM approvals a
       JOIN agent_runs r ON r.id = a.run_id
       WHERE a.status = 'approved'
         AND r.status = 'pending_approval'
         AND a.run_id IS NOT NULL
       ORDER BY a.created_at ASC
       LIMIT ?`,
    )
    .bind(bounded)
    .all<{ run_id: string; idempotency_key: string }>();
  return rows.results.map((row) =>
    parseApprovalResumeMessage({
      runId: row.run_id,
      idempotencyKey: row.idempotency_key,
    }),
  );
}

export async function replayRecoverableApprovalResumes(
  db: OperationsDatabase,
  enqueue: (message: ApprovalResumeMessage) => Promise<void>,
  limit = 20,
): Promise<{ enqueued: number }> {
  const messages = await listRecoverableApprovalResumes(db, limit);
  for (const message of messages) {
    await enqueue(message);
  }
  return { enqueued: messages.length };
}
