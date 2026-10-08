import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { IdempotentExecutor, MemoryIdempotencyStore } from "../../../src/lib/agent/approvals";
import { nonReadToolPolicies, toolPolicy } from "../../../src/lib/agent/policy";
import { CreateTicketParams, isCreateTicketArguments } from "../../../src/lib/contracts/approvals";
import { createCreateTicketTool } from "../../../src/lib/connectors/tools";
import { recordPendingApproval } from "../../../src/lib/store/approval-view";
import { pendingTicketRun, TICKET_ARGS } from "./ticket-helpers";

describe("create_ticket schema", () => {
  it("rejects a desk other than Support", () => {
    expect(isCreateTicketArguments({ ...TICKET_ARGS, desk: "Sales" })).toBe(false);
  });

  it("rejects priorities outside P0..P3", () => {
    expect(isCreateTicketArguments({ ...TICKET_ARGS, priority: "P9" })).toBe(false);
    expect(isCreateTicketArguments({ ...TICKET_ARGS, priority: "p1" })).toBe(false);
  });

  it("rejects extra keys, missing keys and empty strings", () => {
    expect(isCreateTicketArguments({ ...TICKET_ARGS, assignee: "x" })).toBe(false);
    expect(isCreateTicketArguments({ desk: "Support", priority: "P1", customer: "A" })).toBe(false);
    expect(isCreateTicketArguments({ ...TICKET_ARGS, customer: "" })).toBe(false);
    expect(isCreateTicketArguments({ ...TICKET_ARGS, subject: "" })).toBe(false);
  });

  it("rejects oversize customer and subject", () => {
    expect(isCreateTicketArguments({ ...TICKET_ARGS, customer: "c".repeat(121) })).toBe(false);
    expect(isCreateTicketArguments({ ...TICKET_ARGS, subject: "s".repeat(201) })).toBe(false);
  });

  it("accepts the boundary lengths", () => {
    expect(
      isCreateTicketArguments({ ...TICKET_ARGS, customer: "c".repeat(120), subject: "s".repeat(200) }),
    ).toBe(true);
  });

  it("is a closed object schema", () => {
    expect(CreateTicketParams.additionalProperties).toBe(false);
  });
});

describe("create_ticket policy", () => {
  it("is an external write that must run sequentially", () => {
    expect(toolPolicy("create_ticket")).toEqual({
      name: "create_ticket",
      risk: "external_write",
      executionMode: "sequential",
    });
    expect(nonReadToolPolicies().every((policy) => policy.executionMode === "sequential")).toBe(true);
  });
});

describe("create_ticket tool", () => {
  const principal = { id: "principal-alice" };

  let created = 0;

  function tool(now = Date.now()) {
    return createCreateTicketTool({
      createTicket: async () => {
        created += 1;
        return { id: "SUP-0" };
      },
      principal,
      conversationId: "conv-tool",
      executor: new IdempotentExecutor(new MemoryIdempotencyStore()),
      now,
    });
  }

  it("is sequential and returns pending approval without creating a ticket", async () => {
    const ticketTool = tool();
    expect(ticketTool.executionMode).toBe("sequential");
    const result = await ticketTool.execute("call-1", TICKET_ARGS);
    expect(result.details).toMatchObject({ pendingApproval: true });
    expect(result.terminate).toBe(true);
    expect(created).toBe(0);
  });

  it("refuses invalid arguments at the tool boundary", async () => {
    const result = await tool().execute("call-2", { ...TICKET_ARGS, priority: "P9" } as never);
    expect(result.details).not.toMatchObject({ pendingApproval: true });
    expect(result.terminate).toBe(true);
    expect(JSON.stringify(result.content)).toContain("invalid");
    expect(created).toBe(0);
  });
});

describe("recordPendingApproval", () => {
  it("rejects arguments that fail the create_ticket schema", async () => {
    await expect(pendingTicketRun("bad-args", { ...TICKET_ARGS, priority: "P9" } as never)).rejects.toThrow();
  });

  it("rejects a binding whose fingerprint differs from the recorded call", async () => {
    const ok = await pendingTicketRun("fp-ok");
    await expect(
      recordPendingApproval(env.OPERATIONS_DB, {
        assistantMessageId: ok.assistantMessageId,
        conversationId: ok.conversationId,
        principalId: "principal-alice",
        model: "m",
        promptVersion: "p",
        corpusGenerationId: "gen-1",
        toolCalls: [{
          tool: "create_ticket",
          argumentFingerprint: "different",
          normalizedArguments: TICKET_ARGS,
          redactedResult: "pending_approval",
          status: "pending_approval",
        }],
        binding: { ...ok.binding, argumentFingerprint: "different" },
        now: Date.now(),
      }),
    ).rejects.toThrow();
  });
});
