import { env } from "cloudflare:workers";

import { mutatingIdempotencyKey } from "../../../src/lib/agent/approvals";
import { argumentFingerprint, type ApprovalBinding } from "../../../src/lib/agent/policy";
import { PROMPT_VERSION } from "../../../src/lib/answer/contract";
import type { CreateTicketArguments } from "../../../src/lib/contracts/approvals";
import { recordPendingApproval } from "../../../src/lib/store/approval-view";
import { createPendingTurn } from "../../../src/lib/store/conversations";
import { seedPrincipals } from "./seed";

export const TICKET_ARGS: CreateTicketArguments = {
  desk: "Support",
  priority: "P1",
  customer: "Acme Logistics",
  subject: "Refund stuck after chargeback",
};

export async function pendingTicketRun(
  suffix: string,
  args: CreateTicketArguments = TICKET_ARGS,
  options: { principalId?: string; expiresInMs?: number; now?: number } = {},
): Promise<{
  runId: string;
  assistantMessageId: string;
  conversationId: string;
  binding: ApprovalBinding;
}> {
  await seedPrincipals();
  const principalId = options.principalId ?? "principal-alice";
  const now = options.now ?? Date.now();
  const pending = await createPendingTurn(env.OPERATIONS_DB, {
    ownerPrincipalId: principalId,
    requestId: `req-ticket-${suffix}`,
    question: "Open a ticket for Acme",
    now,
  });
  const idempotencyKey = await mutatingIdempotencyKey(
    "create_ticket",
    args,
    `${principalId}-${pending.conversationId}-tc-${suffix}`,
  );
  const binding: ApprovalBinding = {
    principalId,
    conversationId: pending.conversationId,
    tool: "create_ticket",
    argumentFingerprint: argumentFingerprint(args),
    idempotencyKey,
    expiresAt: now + (options.expiresInMs ?? 10 * 60 * 1000),
  };
  const { runId } = await recordPendingApproval(env.OPERATIONS_DB, {
    assistantMessageId: pending.assistantMessageId,
    conversationId: pending.conversationId,
    principalId,
    model: "phase5-faux",
    promptVersion: PROMPT_VERSION,
    corpusGenerationId: "gen-1",
    toolCalls: [{
      tool: "create_ticket",
      argumentFingerprint: binding.argumentFingerprint,
      normalizedArguments: args,
      redactedResult: "pending_approval",
      status: "pending_approval",
    }],
    binding,
    now,
  });
  return { runId, assistantMessageId: pending.assistantMessageId, conversationId: pending.conversationId, binding };
}
