import { redactJsonSecrets } from "../agent/redact-tool-result";
import { argumentFingerprint, type ApprovalBinding, type PolicyPrincipal } from "../agent/policy";
import { parseBoundedId } from "../cf/bounded-id";
import {
  isCreateTicketArguments,
  type ApprovalView,
  type ApprovalViewState,
} from "../contracts/approvals";
import { completeAgentRun, createAgentRun, upsertApproval, type StoredToolCall } from "./agent-runs";
import type { OperationsDatabase } from "./conversations";
import { loadTicketByKey } from "./tickets";

const MAX_DISPLAY_ARGUMENTS_BYTES = 4096;

/** Redacted, bounded copy of the arguments for the approval card. */
export function displayArgumentsJson(args: unknown): string {
  const json = JSON.stringify(redactJsonSecrets(args));
  if (new TextEncoder().encode(json).byteLength > MAX_DISPLAY_ARGUMENTS_BYTES) {
    throw new Error("approval display arguments are too large");
  }
  return json;
}

/**
 * Persist the pending run, its single pending tool call and the pending approval
 * from a Pi pendingApproval result. Safe to call again for the same assistant message.
 */
export async function recordPendingApproval(
  db: OperationsDatabase,
  input: {
    assistantMessageId: string;
    conversationId: string;
    principalId: string;
    model: string;
    promptVersion: string;
    corpusGenerationId: string;
    toolCalls: StoredToolCall[];
    binding: ApprovalBinding;
    now: number;
  },
): Promise<{ runId: string }> {
  const pending = input.toolCalls.filter((call) => call.status === "pending_approval");
  if (pending.length !== 1) {
    throw new Error("a pending approval needs exactly one pending tool call");
  }
  const call = pending[0];
  const fingerprint = argumentFingerprint(call.normalizedArguments);
  if (
    call.tool !== input.binding.tool ||
    call.argumentFingerprint !== fingerprint ||
    input.binding.argumentFingerprint !== fingerprint ||
    input.binding.principalId !== input.principalId ||
    input.binding.conversationId !== input.conversationId
  ) {
    throw new Error("approval binding does not match the pending tool call");
  }
  let display: string | null = null;
  if (call.tool === "create_ticket") {
    if (!isCreateTicketArguments(call.normalizedArguments)) {
      throw new Error("create_ticket arguments are invalid");
    }
    display = displayArgumentsJson(call.normalizedArguments);
  }
  const assistantMessageId = parseBoundedId(input.assistantMessageId, "message id");
  const { runId } = await createAgentRun(db, {
    runId: `run-approval-${assistantMessageId}`,
    conversationId: input.conversationId,
    principalId: input.principalId,
    model: input.model,
    promptVersion: input.promptVersion,
    corpusGenerationId: input.corpusGenerationId,
    evidenceMessageId: assistantMessageId,
    now: input.now,
  });
  await completeAgentRun(db, {
    runId,
    status: "pending_approval",
    toolCalls: input.toolCalls,
    now: input.now,
  });
  await upsertApproval(db, runId, input.binding, "pending", input.now, display);
  return { runId };
}

type ViewRow = {
  run_id: string;
  idempotency_key: string;
  tool: string;
  status: "pending" | "approved" | "rejected" | "expired";
  expires_at: number;
  display_arguments_json: string | null;
};

/** Owner-only. Returns null for a non-owner, an unknown message or a legacy approval. */
export async function loadApprovalViewForMessage(
  db: OperationsDatabase,
  assistantMessageId: string,
  principal: PolicyPrincipal,
  now = Date.now(),
): Promise<ApprovalView | null> {
  const row = await db
    .prepare(
      `SELECT r.id AS run_id, a.idempotency_key AS idempotency_key, a.tool AS tool,
              a.status AS status, a.expires_at AS expires_at,
              a.display_arguments_json AS display_arguments_json
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id AND c.owner_principal_id = ?
       JOIN agent_runs r ON r.evidence_message_id = m.id AND r.principal_id = ?
       JOIN approvals a ON a.run_id = r.id
       WHERE m.id = ? AND m.role = 'assistant'
       ORDER BY r.created_at DESC
       LIMIT 1`,
    )
    .bind(
      parseBoundedId(principal.id, "principal id"),
      principal.id,
      parseBoundedId(assistantMessageId, "message id"),
    )
    .first<ViewRow>();
  if (!row || row.tool !== "create_ticket" || !row.display_arguments_json) {
    return null;
  }
  let args: unknown;
  try {
    args = JSON.parse(row.display_arguments_json);
  } catch {
    return null;
  }
  if (!isCreateTicketArguments(args)) {
    return null;
  }
  const state: ApprovalViewState =
    row.status === "rejected"
      ? "denied"
      : row.status === "pending" && now > row.expires_at
        ? "expired"
        : row.status;
  const ticket = row.status === "approved" ? await loadTicketByKey(db, row.idempotency_key) : null;
  return {
    runId: row.run_id,
    state,
    tool: "create_ticket",
    arguments: args,
    expiresAt: row.expires_at,
    ...(ticket ? { ticket: { id: ticket.id, createdAt: ticket.createdAt } } : {}),
  };
}
