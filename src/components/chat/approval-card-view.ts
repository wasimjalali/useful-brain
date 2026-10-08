import type { ApprovalView as ApprovalRecord } from "@/lib/contracts/approvals";
import type { ApprovalView as ApprovalCardView } from "@/lib/contracts/chat-view";

const ARGUMENT_ORDER = ["desk", "priority", "customer", "subject"] as const;

/**
 * Card view of a stored approval. An approved record without its ticket yet
 * returns null: the run is still going, so there is nothing to claim.
 */
export function approvalCardView(approval: ApprovalRecord, now: number): ApprovalCardView | null {
  switch (approval.state) {
    case "pending":
      if (approval.expiresAt <= now) {
        return { status: "expired" };
      }
      return {
        status: "pending",
        tool: approval.tool,
        args: ARGUMENT_ORDER.map((key) => [key, approval.arguments[key]] as [string, string]),
      };
    case "approved":
      return approval.ticket
        ? {
            status: "done",
            ticketId: approval.ticket.id,
            priority: approval.arguments.priority,
            customer: approval.arguments.customer,
            subject: approval.arguments.subject,
            createdAt: approval.ticket.createdAt,
          }
        : null;
    case "denied":
      return { status: "denied" };
    case "expired":
      return { status: "expired" };
  }
}
