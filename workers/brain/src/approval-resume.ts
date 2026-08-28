import { parseBoundedId, parseMutatingIdempotencyKey } from "../../../src/lib/cf/bounded-id";
import { argumentFingerprint, policyGateway } from "../../../src/lib/agent/policy";
import { expireApproval, loadAgentReplay } from "../../../src/lib/store/agent-runs";
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
): Promise<{ resumed: boolean; duplicate?: boolean; expired?: boolean }> {
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
  if (run.status === "failed" && run.approval?.status === "expired") {
    return { resumed: false, expired: true };
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
  if (now > run.approval.expiresAt) {
    await expireApproval(db, {
      runId,
      storedBinding: run.approval,
      now,
    });
    return { resumed: false, expired: true };
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

  return commitApprovedResumeWrites(db, {
    runId,
    idempotencyKey,
    tool: call.tool,
    toolCallId: call.id,
    args,
    now,
  });
}

const STILL_APPROVED_RESUME = `EXISTS (
  SELECT 1 FROM agent_runs r
  JOIN approvals a ON a.run_id = r.id
  WHERE r.id = ?
    AND r.status = 'pending_approval'
    AND a.status = 'approved'
    AND a.idempotency_key = ?
    AND a.expires_at >= ?
)`;

export async function commitApprovedResumeWrites(
  db: OperationsDatabase,
  input: {
    runId: string;
    idempotencyKey: string;
    tool: string;
    toolCallId: string;
    args: Record<string, unknown>;
    now: number;
  },
): Promise<{ resumed: boolean; duplicate?: boolean; expired?: boolean }> {
  const { runId, idempotencyKey, tool, toolCallId, args, now } = input;
  const resultJson = JSON.stringify({ resumed: true, tool });
  const argsJson = JSON.stringify(args);
  await db.batch([
    db
      .prepare(
        `INSERT INTO synthetic_mutating_effects (
           idempotency_key, tool, normalized_arguments_json, created_at
         ) SELECT ?, ?, ?, ?
         WHERE ${STILL_APPROVED_RESUME}
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .bind(idempotencyKey, tool, argsJson, now, runId, idempotencyKey, now),
    db
      .prepare(
        `INSERT INTO idempotent_effects (
           idempotency_key, status, result_json, created_at, updated_at
         ) SELECT ?, 'completed', ?, ?, ?
         WHERE ${STILL_APPROVED_RESUME}
         ON CONFLICT(idempotency_key) DO UPDATE SET
           status = 'completed', result_json = excluded.result_json,
           updated_at = excluded.updated_at
         WHERE ${STILL_APPROVED_RESUME}`,
      )
      .bind(
        idempotencyKey,
        resultJson,
        now,
        now,
        runId,
        idempotencyKey,
        now,
        runId,
        idempotencyKey,
        now,
      ),
    db
      .prepare(
        `UPDATE tool_calls SET status = 'ok', redacted_result = ?
         WHERE id = ? AND run_id = ? AND status = 'pending_approval'
           AND ${STILL_APPROVED_RESUME}`,
      )
      .bind(resultJson, toolCallId, runId, runId, idempotencyKey, now),
    db
      .prepare(
        `UPDATE agent_runs SET status = 'completed', updated_at = ?
         WHERE id = ? AND status = 'pending_approval'
           AND ${STILL_APPROVED_RESUME}`,
      )
      .bind(now, runId, runId, idempotencyKey, now),
  ]);
  const after = await loadAgentReplay(db, runId);
  if (after?.status === "completed") {
    return { resumed: true };
  }
  if (after?.status === "failed" && after.approval?.status === "expired") {
    return { resumed: false, expired: true };
  }
  throw new Error("approved resume could not complete");
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
         AND a.expires_at >= ?
       ORDER BY a.created_at ASC
       LIMIT ?`,
    )
    .bind(Date.now(), bounded)
    .all<{ run_id: string; idempotency_key: string }>();
  return rows.results.map((row) =>
    parseApprovalResumeMessage({
      runId: row.run_id,
      idempotencyKey: row.idempotency_key,
    }),
  );
}

export async function expireOverdueApprovalResumes(
  db: OperationsDatabase,
  now = Date.now(),
  limit = 20,
): Promise<number> {
  const bounded = Math.max(1, Math.min(limit, 20));
  const rows = await db
    .prepare(
      `SELECT a.run_id AS run_id, a.principal_id AS principal_id, a.conversation_id AS conversation_id,
              a.tool AS tool, a.argument_fingerprint AS argument_fingerprint,
              a.idempotency_key AS idempotency_key, a.expires_at AS expires_at
       FROM approvals a
       JOIN agent_runs r ON r.id = a.run_id
       WHERE a.status = 'approved'
         AND r.status = 'pending_approval'
         AND a.expires_at < ?
       ORDER BY a.created_at ASC
       LIMIT ?`,
    )
    .bind(now, bounded)
    .all<{
      run_id: string;
      principal_id: string;
      conversation_id: string;
      tool: string;
      argument_fingerprint: string;
      idempotency_key: string;
      expires_at: number;
    }>();
  for (const row of rows.results) {
    await expireApproval(db, {
      runId: row.run_id,
      storedBinding: {
        principalId: row.principal_id,
        conversationId: row.conversation_id,
        tool: row.tool,
        argumentFingerprint: row.argument_fingerprint,
        idempotencyKey: row.idempotency_key,
        expiresAt: row.expires_at,
      },
      now,
    });
  }
  return rows.results.length;
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

export async function enqueueRecoverableApprovalResumes(
  db: OperationsDatabase,
  queue: { send(message: ApprovalResumeMessage): Promise<unknown> },
  limit = 20,
): Promise<{ enqueued: number }> {
  await expireOverdueApprovalResumes(db, Date.now(), limit);
  return replayRecoverableApprovalResumes(db, async (message) => {
    await queue.send(message);
  }, limit);
}
