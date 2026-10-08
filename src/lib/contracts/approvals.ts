import { Type, type Static } from "typebox";
import Value from "typebox/value";

export const TICKET_DESK = "Support";
export const TICKET_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const CreateTicketParams = Type.Object(
  {
    desk: Type.Literal(TICKET_DESK),
    priority: Type.Union([Type.Literal("P0"), Type.Literal("P1"), Type.Literal("P2"), Type.Literal("P3")]),
    customer: Type.String({ minLength: 1, maxLength: 120 }),
    subject: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);
export type CreateTicketArguments = Static<typeof CreateTicketParams>;

export function isCreateTicketArguments(value: unknown): value is CreateTicketArguments {
  return Value.Check(CreateTicketParams, value);
}

export type ApprovalViewState = "pending" | "approved" | "denied" | "expired";

/** Owner-only read model for the approval card under an assistant message. */
export type ApprovalView = {
  /** Agent run id. Send it to /approvals/start; the server recomputes the binding. */
  runId: string;
  state: ApprovalViewState;
  tool: "create_ticket";
  /** Redacted display copy of the stored arguments. */
  arguments: CreateTicketArguments;
  expiresAt: number;
  ticket?: { id: string; createdAt: number };
};

export function formatTicketId(seq: number): string {
  return `SUP-${seq}`;
}
