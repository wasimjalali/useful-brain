import type { ApprovalBinding } from "../agent/policy";
import { parseBoundedId } from "../cf/bounded-id";
import { newBoundedId, type OperationsDatabase } from "./conversations";

export type StoredToolCall = {
  tool: string;
  argumentFingerprint: string;
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
  approval: ApprovalBinding | null;
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
           id, run_id, tool, argument_fingerprint, redacted_result, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newBoundedId("tc"),
        runId,
        call.tool,
        call.argumentFingerprint,
        call.redactedResult,
        call.status,
        input.now + index,
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
  binding: ApprovalBinding,
  status: "pending" | "approved" | "rejected" | "expired",
  now: number,
): Promise<void> {
  const key = parseBoundedId(binding.idempotencyKey, "idempotency key");
  const existing = await db
    .prepare(`SELECT argument_fingerprint FROM approvals WHERE idempotency_key = ?`)
    .bind(key)
    .first<{ argument_fingerprint: string }>();
  if (existing) {
    if (existing.argument_fingerprint !== binding.argumentFingerprint) {
      return;
    }
    await db
      .prepare(`UPDATE approvals SET status = ?, expires_at = ? WHERE idempotency_key = ?`)
      .bind(status, binding.expiresAt, key)
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO approvals (
         idempotency_key, principal_id, conversation_id, tool, argument_fingerprint,
         expires_at, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      key,
      parseBoundedId(binding.principalId, "principal id"),
      parseBoundedId(binding.conversationId, "conversation id"),
      binding.tool,
      binding.argumentFingerprint,
      binding.expiresAt,
      status,
      now,
    )
    .run();
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
      `SELECT id, tool, argument_fingerprint, redacted_result, status
       FROM tool_calls WHERE run_id = ? ORDER BY created_at ASC`,
    )
    .bind(id)
    .all<{
      id: string;
      tool: string;
      argument_fingerprint: string;
      redacted_result: string;
      status: StoredToolCall["status"];
    }>();
  const approval = await db
    .prepare(
      `SELECT idempotency_key, principal_id, conversation_id, tool, argument_fingerprint, expires_at
       FROM approvals WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(run.conversation_id)
    .first<{
      idempotency_key: string;
      principal_id: string;
      conversation_id: string;
      tool: string;
      argument_fingerprint: string;
      expires_at: number;
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
      redactedResult: call.redacted_result,
      status: call.status,
    })),
    approval: approval
      ? {
          principalId: approval.principal_id,
          conversationId: approval.conversation_id,
          tool: approval.tool,
          argumentFingerprint: approval.argument_fingerprint,
          idempotencyKey: approval.idempotency_key,
          expiresAt: approval.expires_at,
        }
      : null,
  };
}
