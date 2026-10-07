import { describe, expect, it } from "vitest";

import type { ApprovalView as ApprovalRecord } from "@/lib/contracts/approvals";

import { approvalCardView } from "./approval-card-view";

const base: ApprovalRecord = {
  runId: "run1",
  state: "pending",
  tool: "create_ticket",
  arguments: { desk: "Support", priority: "P1" as never, customer: "Halvorsen Freight", subject: "Atlas sync stalled" },
  expiresAt: 2_000,
};

describe("approvalCardView", () => {
  it("shows the exact arguments, in order, while pending", () => {
    expect(approvalCardView(base, 1_000)).toEqual({
      status: "pending",
      tool: "create_ticket",
      args: [
        ["desk", "Support"],
        ["priority", "P1"],
        ["customer", "Halvorsen Freight"],
        ["subject", "Atlas sync stalled"],
      ],
    });
  });

  it("treats a pending approval past its expiry as expired", () => {
    expect(approvalCardView(base, 2_000)).toEqual({ status: "expired" });
    expect(approvalCardView(base, 9_999)).toEqual({ status: "expired" });
  });

  it("maps denied and expired states", () => {
    expect(approvalCardView({ ...base, state: "denied" }, 1)).toEqual({ status: "denied" });
    expect(approvalCardView({ ...base, state: "expired" }, 1)).toEqual({ status: "expired" });
  });

  it("maps an approved ticket with its id, priority and local time", () => {
    const createdAt = new Date(2026, 8, 6, 9, 42).getTime();
    expect(approvalCardView({ ...base, state: "approved", ticket: { id: "SUP-4821", createdAt } }, 1)).toEqual({
      status: "done",
      ticketId: "SUP-4821",
      meta: "create_ticket · P1 · 09:42",
    });
  });

  it("stays pending-safe when an approved record has no ticket yet", () => {
    expect(approvalCardView({ ...base, state: "approved" }, 1)).toBeNull();
  });
});
