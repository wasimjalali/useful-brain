import { AGENT_BUDGETS } from "../agent/budgets";
import { approvalsMatch, argumentFingerprint, type ApprovalBinding } from "../agent/policy";
import { parseBoundedId, parseMutatingIdempotencyKey } from "../cf/bounded-id";
import { newBoundedId, type OperationsDatabase } from "./conversations";

export type StoredToolCall = {
  tool: string;
  argumentFingerprint: string;
  normalizedArguments: unknown;
  redactedResult: string;
  status: "ok" | "error" | "denied" | "pending_approval";
};

export type AgentRunStatus = "running" | "completed" | "failed" | "cancelled" | "pending_approval";

export type StoredAgentRun = {
  id: string;
  conversationId: string;
  principalId: string;
  status: AgentRunStatus;
  model: string | null;
  promptVersion: string | null;
  corpusGenerationId: string | null;
  evidenceMessageId: string | null;
  toolCalls: Array<StoredToolCall & { id: string }>;
  approval: (ApprovalBinding & {
    runId: string;
    status: "pending" | "approved" | "rejected" | "expired";
  }) | null;
};

export async function createAgentRun(
  db: OperationsDatabase,
  input: {
    conversationId: string;
    principalId: string;
    model: string;
    promptVersion: string;
    corpusGenerationId: string;
    evidenceMessageId?: string;
    now: number;
    runId?: string;
  },
): Promise<{ runId: string }> {
  const runId = input.runId ? parseBoundedId(input.runId, "run id") : newBoundedId("run");
  const existing = await db
    .prepare(`SELECT id FROM agent_runs WHERE id = ?`)
    .bind(runId)
    .first<{ id: string }>();
  if (existing) {
    return { runId: existing.id };
  }
  await db
    .prepare(
      `INSERT INTO agent_runs (
         id, conversation_id, principal_id, status, model, prompt_version,
         corpus_generation_id, evidence_message_id, created_at, updated_at
       ) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      runId,
      parseBoundedId(input.conversationId, "conversation id"),
      parseBoundedId(input.principalId, "principal id"),
      input.model,
      input.promptVersion,
      parseBoundedId(input.corpusGenerationId, "corpus generation id"),
      input.evidenceMessageId ? parseBoundedId(input.evidenceMessageId, "message id") : null,
      input.now,
      input.now,
    )
    .run();
  return { runId };
}

export async function completeAgentRun(
  db: OperationsDatabase,
  input: {
    runId: string;
    status: Exclude<AgentRunStatus, "running">;
    toolCalls: StoredToolCall[];
    now: number;
  },
): Promise<void> {
  const runId = parseBoundedId(input.runId, "run id");
  const current = await db
    .prepare(`SELECT status FROM agent_runs WHERE id = ?`)
    .bind(runId)
    .first<{ status: string }>();
  if (!current) {
    throw new Error("agent run not found");
  }
  if (current.status !== "running") {
    return;
  }
  const statements = input.toolCalls.map((call, index) =>
    db
      .prepare(
        `INSERT INTO tool_calls (
           id, run_id, tool, argument_fingerprint, normalized_arguments_json,
           redacted_result, status, created_at
         ) SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM agent_runs WHERE id = ? AND status = 'running'
         )`,
      )
      .bind(
        newBoundedId("tc"),
        runId,
        call.tool,
        call.argumentFingerprint,
        JSON.stringify(call.normalizedArguments),
        call.redactedResult,
        call.status,
        input.now + index,
        runId,
      ),
  );
  statements.push(
    db
      .prepare(`UPDATE agent_runs SET status = ?, updated_at = ? WHERE id = ? AND status = 'running'`)
      .bind(input.status, input.now, runId),
  );
  await db.batch(statements);
}

export async function upsertApproval(
  db: OperationsDatabase,
  runIdInput: string,
  binding: ApprovalBinding,
  status: "pending" | "approved" | "rejected" | "expired",
  now: number,
): Promise<void> {
  const runId = parseBoundedId(runIdInput, "run id");
  const key = parseMutatingIdempotencyKey(binding.idempotencyKey);
  const principalId = parseBoundedId(binding.principalId, "principal id");
  const conversationId = parseBoundedId(binding.conversationId, "conversation id");
  if (binding.expiresAt <= now || binding.expiresAt > now + AGENT_BUDGETS.approvalExpiryMs) {
    throw new Error("approval expiry is outside the allowed window");
  }
  const existing = await db
    .prepare(
      `SELECT run_id, principal_id, conversation_id, tool, argument_fingerprint, expires_at
       FROM approvals WHERE idempotency_key = ?`,
    )
    .bind(key)
    .first<{
      run_id: string | null;
      principal_id: string;
      conversation_id: string;
      tool: string;
      argument_fingerprint: string;
      expires_at: number;
    }>();
  if (existing) {
    if (
      existing.run_id !== runId ||
      existing.principal_id !== principalId ||
      existing.conversation_id !== conversationId ||
      existing.tool !== binding.tool ||
      existing.argument_fingerprint !== binding.argumentFingerprint ||
      existing.expires_at !== binding.expiresAt
    ) {
      throw new Error("approval binding mismatch for idempotency key");
    }
    if (status !== "pending") {
      throw new Error("approval records can only be upserted as pending");
    }
    return;
  }
  if (status !== "pending") {
    throw new Error("new approval records must start pending");
  }
  const run = await db
    .prepare(
      `SELECT principal_id, conversation_id, status
       FROM agent_runs WHERE id = ?`,
    )
    .bind(runId)
    .first<{ principal_id: string; conversation_id: string; status: AgentRunStatus }>();
  if (
    !run ||
    run.status !== "pending_approval" ||
    run.principal_id !== principalId ||
    run.conversation_id !== conversationId
  ) {
    throw new Error("approval does not match a pending agent run");
  }
  const calls = await db
    .prepare(
      `SELECT tool, argument_fingerprint, normalized_arguments_json
       FROM tool_calls WHERE run_id = ? AND status = 'pending_approval'`,
    )
    .bind(runId)
    .all<{
      tool: string;
      argument_fingerprint: string;
      normalized_arguments_json: string;
    }>();
  if (calls.results.length !== 1) {
    throw new Error("agent run must have exactly one pending approval tool");
  }
  const call = calls.results[0];
  const normalizedArguments = JSON.parse(call.normalized_arguments_json) as unknown;
  if (
    call.tool !== binding.tool ||
    call.argument_fingerprint !== binding.argumentFingerprint ||
    argumentFingerprint(normalizedArguments) !== binding.argumentFingerprint
  ) {
    throw new Error("approval binding does not match the pending tool call");
  }
  await db
    .prepare(
      `INSERT INTO approvals (
         idempotency_key, principal_id, conversation_id, tool, argument_fingerprint,
         expires_at, status, created_at, run_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      key,
      principalId,
      conversationId,
      binding.tool,
      binding.argumentFingerprint,
      binding.expiresAt,
      status,
      now,
      runId,
    )
    .run();
}

export async function decideApproval(
  db: OperationsDatabase,
  input: {
    runId: string;
    storedBinding: ApprovalBinding;
    eventBinding: ApprovalBinding;
    decision: "approve" | "reject";
    now: number;
  },
): Promise<{ resume: true; idempotencyKey: string } | { resume: false; reason: string }> {
  const runId = parseBoundedId(input.runId, "run id");
  const key = parseMutatingIdempotencyKey(input.storedBinding.idempotencyKey);
  const row = await db
    .prepare(
      `SELECT run_id, principal_id, conversation_id, tool, argument_fingerprint,
              expires_at, status
       FROM approvals WHERE idempotency_key = ?`,
    )
    .bind(key)
    .first<{
      run_id: string | null;
      principal_id: string;
      conversation_id: string;
      tool: string;
      argument_fingerprint: string;
      expires_at: number;
      status: "pending" | "approved" | "rejected" | "expired";
    }>();
  if (!row || row.run_id !== runId) {
    return { resume: false, reason: "approval record does not match the agent run" };
  }
  const persisted: ApprovalBinding = {
    principalId: row.principal_id,
    conversationId: row.conversation_id,
    tool: row.tool,
    argumentFingerprint: row.argument_fingerprint,
    idempotencyKey: key,
    expiresAt: row.expires_at,
  };
  if (
    !approvalsMatch(persisted, input.storedBinding, input.now) ||
    !approvalsMatch(persisted, input.eventBinding, input.now)
  ) {
    if (input.now > persisted.expiresAt && row.status === "pending") {
      await db.batch([
        db
          .prepare(
            `UPDATE approvals SET status = 'expired'
             WHERE idempotency_key = ? AND status = 'pending'`,
          )
          .bind(key),
        db
          .prepare(
            `UPDATE tool_calls SET status = 'denied', redacted_result = 'approval expired'
             WHERE run_id = ? AND status = 'pending_approval'`,
          )
          .bind(runId),
        db
          .prepare(
            `UPDATE agent_runs SET status = 'failed', updated_at = ?
             WHERE id = ? AND status = 'pending_approval'`,
          )
          .bind(input.now, runId),
      ]);
    }
    return { resume: false, reason: "approval does not match stored binding" };
  }
  if (input.decision === "reject") {
    await db.batch([
      db
        .prepare(
          `UPDATE approvals SET status = 'rejected'
           WHERE idempotency_key = ? AND status = 'pending'`,
        )
        .bind(key),
      db
        .prepare(
          `UPDATE tool_calls SET status = 'denied', redacted_result = 'approval rejected'
           WHERE run_id = ? AND status = 'pending_approval'`,
        )
        .bind(runId),
      db
        .prepare(
          `UPDATE agent_runs SET status = 'failed', updated_at = ?
           WHERE id = ? AND status = 'pending_approval'`,
        )
        .bind(input.now, runId),
    ]);
    return { resume: false, reason: "rejected" };
  }
  if (row.status === "rejected" || row.status === "expired") {
    return { resume: false, reason: `approval is ${row.status}` };
  }
  if (row.status === "pending") {
    await db
      .prepare(
        `UPDATE approvals SET status = 'approved'
         WHERE idempotency_key = ? AND status = 'pending'`,
      )
      .bind(key)
      .run();
  }
  return { resume: true, idempotencyKey: key };
}

export async function expireApproval(
  db: OperationsDatabase,
  input: {
    runId: string;
    storedBinding: ApprovalBinding;
    now: number;
  },
): Promise<{ resume: false; reason: string }> {
  const runId = parseBoundedId(input.runId, "run id");
  const key = parseMutatingIdempotencyKey(input.storedBinding.idempotencyKey);
  const row = await db
    .prepare(
      `SELECT run_id, principal_id, conversation_id, tool, argument_fingerprint,
              expires_at, status
       FROM approvals WHERE idempotency_key = ?`,
    )
    .bind(key)
    .first<{
      run_id: string | null;
      principal_id: string;
      conversation_id: string;
      tool: string;
      argument_fingerprint: string;
      expires_at: number;
      status: "pending" | "approved" | "rejected" | "expired";
    }>();
  if (
    !row ||
    row.run_id !== runId ||
    row.principal_id !== input.storedBinding.principalId ||
    row.conversation_id !== input.storedBinding.conversationId ||
    row.tool !== input.storedBinding.tool ||
    row.argument_fingerprint !== input.storedBinding.argumentFingerprint ||
    row.expires_at !== input.storedBinding.expiresAt
  ) {
    return { resume: false, reason: "approval record does not match the agent run" };
  }
  if (row.status === "rejected" || row.status === "expired") {
    return { resume: false, reason: `approval is ${row.status}` };
  }
  if (row.status === "approved" && input.now <= row.expires_at) {
    return { resume: false, reason: "approval is approved" };
  }
  await db.batch([
    db
      .prepare(
        `UPDATE approvals SET status = 'expired'
         WHERE idempotency_key = ? AND status IN ('pending', 'approved')`,
      )
      .bind(key),
    db
      .prepare(
        `UPDATE tool_calls SET status = 'denied', redacted_result = 'approval expired'
         WHERE run_id = ? AND status = 'pending_approval'`,
      )
      .bind(runId),
    db
      .prepare(
        `UPDATE agent_runs SET status = 'failed', updated_at = ?
         WHERE id = ? AND status = 'pending_approval'`,
      )
      .bind(input.now, runId),
  ]);
  return { resume: false, reason: "expired" };
}

export async function loadAgentReplay(
  db: OperationsDatabase,
  runId: string,
): Promise<StoredAgentRun | null> {
  const id = parseBoundedId(runId, "run id");
  const run = await db
    .prepare(
      `SELECT id, conversation_id, principal_id, status, model, prompt_version,
              corpus_generation_id, evidence_message_id
       FROM agent_runs WHERE id = ?`,
    )
    .bind(id)
    .first<{
      id: string;
      conversation_id: string;
      principal_id: string;
      status: AgentRunStatus;
      model: string | null;
      prompt_version: string | null;
      corpus_generation_id: string | null;
      evidence_message_id: string | null;
    }>();
  if (!run) {
    return null;
  }
  const calls = await db
    .prepare(
      `SELECT id, tool, argument_fingerprint, normalized_arguments_json, redacted_result, status
       FROM tool_calls WHERE run_id = ? ORDER BY created_at ASC`,
    )
    .bind(id)
    .all<{
      id: string;
      tool: string;
      argument_fingerprint: string;
      normalized_arguments_json: string;
      redacted_result: string;
      status: StoredToolCall["status"];
    }>();
  const approval = await db
    .prepare(
      `SELECT idempotency_key, run_id, principal_id, conversation_id, tool,
              argument_fingerprint, expires_at, status
       FROM approvals WHERE run_id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{
      idempotency_key: string;
      run_id: string;
      principal_id: string;
      conversation_id: string;
      tool: string;
      argument_fingerprint: string;
      expires_at: number;
      status: "pending" | "approved" | "rejected" | "expired";
    }>();
  return {
    id: run.id,
    conversationId: run.conversation_id,
    principalId: run.principal_id,
    status: run.status,
    model: run.model,
    promptVersion: run.prompt_version,
    corpusGenerationId: run.corpus_generation_id,
    evidenceMessageId: run.evidence_message_id,
    toolCalls: calls.results.map((call) => ({
      id: call.id,
      tool: call.tool,
      argumentFingerprint: call.argument_fingerprint,
      normalizedArguments: JSON.parse(call.normalized_arguments_json) as unknown,
      redactedResult: call.redacted_result,
      status: call.status,
    })),
    approval: approval
      ? {
          runId: approval.run_id,
          principalId: approval.principal_id,
          conversationId: approval.conversation_id,
          tool: approval.tool,
          argumentFingerprint: approval.argument_fingerprint,
          idempotencyKey: approval.idempotency_key,
          expiresAt: approval.expires_at,
          status: approval.status,
        }
      : null,
  };
}
