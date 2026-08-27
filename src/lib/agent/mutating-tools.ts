import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

import { IdempotentExecutor, mutatingIdempotencyKey } from "./approvals";
import { policyGateway, type ApprovalBinding, type PolicyPrincipal } from "./policy";

const DraftParams = Type.Object({
  title: Type.String({ minLength: 1 }),
});

const DeleteParams = Type.Object({
  recordId: Type.String({ minLength: 1 }),
});

export function createDraftTool(input: {
  principal: PolicyPrincipal;
  conversationId: string;
  executor: IdempotentExecutor;
  drafts: string[];
  approval?: ApprovalBinding | null;
  now?: number;
}): AgentTool<typeof DraftParams, { drafts: number; pendingApproval?: boolean }> {
  return {
    name: "create_draft",
    label: "Create draft",
    description: "Create a reversible draft. Sequential mutating tool.",
    parameters: DraftParams,
    executionMode: "sequential",
    execute: async (_id, params: Static<typeof DraftParams>, signal) => {
      signal?.throwIfAborted();
      const idempotencyKey = mutatingIdempotencyKey("create-draft", params.title);
      const decision = policyGateway({
        tool: "create_draft",
        principal: input.principal,
        conversationId: input.conversationId,
        args: params,
        idempotencyKey,
        now: input.now ?? Date.now(),
        approval: input.approval,
      });
      if (decision.action === "pending_approval") {
        return {
          content: [{ type: "text", text: "pending_approval" }],
          details: { drafts: input.drafts.length, pendingApproval: true },
          terminate: true,
        };
      }
      if (decision.action === "deny") {
        return {
          content: [{ type: "text", text: decision.reason }],
          details: { drafts: input.drafts.length },
          terminate: true,
        };
      }
      await input.executor.run(idempotencyKey, () => {
        input.drafts.push(params.title);
        return params.title;
      });
      return {
        content: [{ type: "text", text: `draft=${params.title}` }],
        details: { drafts: input.drafts.length },
      };
    },
  };
}

export function createDeleteRecordsTool(input: {
  principal: PolicyPrincipal;
  conversationId: string;
}): AgentTool<typeof DeleteParams, { denied: true }> {
  return {
    name: "delete_records",
    label: "Delete records",
    description: "High-risk deletion. Denied in the first release.",
    parameters: DeleteParams,
    executionMode: "sequential",
    execute: async (_id, params: Static<typeof DeleteParams>, signal) => {
      signal?.throwIfAborted();
      const decision = policyGateway({
        tool: "delete_records",
        principal: input.principal,
        conversationId: input.conversationId,
        args: params,
        idempotencyKey: mutatingIdempotencyKey("delete-records", params.recordId),
        now: Date.now(),
      });
      return {
        content: [{ type: "text", text: decision.action === "deny" ? decision.reason : "unexpected allow" }],
        details: { denied: true },
        terminate: true,
      };
    },
  };
}
