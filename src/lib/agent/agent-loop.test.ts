import { describe, expect, it } from "vitest";
import { Agent } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";

import { AGENT_BUDGETS, BudgetExceededError, BudgetTracker } from "./budgets";
import { approvalsMatch, argumentFingerprint, policyGateway, toolPolicy } from "./policy";
import { IdempotentExecutor, MemoryIdempotencyStore, approvalFromAttempt, mutatingIdempotencyKey, resumeAfterApproval } from "./approvals";
import { createDeleteRecordsTool, createDraftTool } from "./mutating-tools";
import { FakeEmbeddingProvider } from "../retrieve/fake-embed";
import { MemoryChunkStore } from "../retrieve/memory-store";
import { KnowledgePipeline } from "../retrieve/pipeline";
import {
  currentRunAssistantTokens,
  runKnowledgeAgent,
  snapshotAgentMessages,
  toolCallsFromMessages,
} from "./run";
import { redactToolResultForStorage } from "./redact-tool-result";
import { BRAIN_KNOWLEDGE_UNAVAILABLE, BRAIN_MUST_RETRIEVE, SEARCH_KNOWLEDGE_TOOL } from "./host-grounding";

const principal = { userId: "support", roles: ["standard"], departments: ["support"] };
const policyPrincipal = { id: "principal-alice" };

async function tinyPipeline() {
  const store = new MemoryChunkStore();
  const embedder = new FakeEmbeddingProvider(8);
  const embeddings = await embedder.embedTexts(["Employees accrue 1.5 days of leave per month."]);
  store.upsert([
    {
      chunkId: "leave-policy__body__000",
      documentId: "leave-policy",
      title: "Leave Policy",
      sourceName: "Leave Policy",
      sourcePath: "leave-policy.md",
      sectionHeading: "Leave",
      content: "Employees accrue 1.5 days of leave per month.",
      chunkIndex: 0,
      charStart: 0,
      charEnd: 46,
      accessScope: "public",
      allowedRoles: [],
      allowedDepartments: [],
      ownerUserId: "",
      embedding: embeddings[0],
    },
  ]);
  return new KnowledgePipeline({ store, embedder });
}

describe("policy gateway", () => {
  it("denies high-risk tools in the first release", async () => {
    expect(toolPolicy("delete_records").risk).toBe("high_risk");
    expect(
      policyGateway({
        tool: "delete_records",
        principal: policyPrincipal,
        conversationId: "c-1",
        args: { recordId: "x" },
        idempotencyKey: await mutatingIdempotencyKey(
          "delete_records",
          { recordId: "x" },
          "principal-alice-c-1-t1",
        ),
        now: 1,
      }),
    ).toEqual({ action: "deny", reason: "high-risk actions are denied in the first release" });
  });

  it("invalidates approval when arguments change", async () => {
    const approval = approvalFromAttempt({
      principalId: policyPrincipal.id,
      conversationId: "c-1",
      tool: "create_draft",
      args: { title: "alpha" },
      idempotencyKey: await mutatingIdempotencyKey(
        "create_draft",
        { title: "alpha" },
        "principal-alice-c-1-t1",
      ),
      expiresAt: 10_000,
    });
    const denied = policyGateway({
      tool: "create_draft",
      principal: policyPrincipal,
      conversationId: "c-1",
      args: { title: "beta" },
      idempotencyKey: await mutatingIdempotencyKey(
        "create_draft",
        { title: "alpha" },
        "principal-alice-c-1-t1",
      ),
      now: 1,
      approval,
    });
    expect(denied.action).toBe("deny");
    expect(argumentFingerprint({ title: "alpha" })).not.toBe(argumentFingerprint({ title: "beta" }));
  });

  it("invalidates approval when its bound expiry changes", () => {
    const stored = approvalFromAttempt({
      principalId: policyPrincipal.id,
      conversationId: "c-1",
      tool: "create_draft",
      args: { title: "alpha" },
      idempotencyKey: "draft-expiry",
      expiresAt: 10_000,
    });
    expect(approvalsMatch(stored, { ...stored, expiresAt: 20_000 }, 1)).toBe(false);
  });

  it("does not repeat a mutating side effect on duplicate delivery", async () => {
    const executor = new IdempotentExecutor(new MemoryIdempotencyStore());
    const drafts: string[] = [];
    const approval = approvalFromAttempt({
      principalId: policyPrincipal.id,
      conversationId: "c-1",
      tool: "create_draft",
      args: { title: "alpha" },
      idempotencyKey: await mutatingIdempotencyKey(
        "create_draft",
        { title: "alpha" },
        "principal-alice-c-1-t1",
      ),
      expiresAt: Date.now() + 60_000,
    });
    const tool = createDraftTool({
      principal: policyPrincipal,
      conversationId: "c-1",
      executor,
      drafts,
      approval,
    });
    await tool.execute("t1", { title: "alpha" });
    await tool.execute("t1", { title: "alpha" });
    expect(drafts).toEqual(["alpha"]);
  });

  it("scopes mutation keys to the exact arguments and action attempt", async () => {
    const first = await mutatingIdempotencyKey(
      "sink_write",
      { title: `${"a".repeat(90)} first` },
      "principal-alice-c-1-t1",
    );
    const second = await mutatingIdempotencyKey(
      "sink_write",
      { title: `${"a".repeat(90)} second` },
      "principal-alice-c-1-t1",
    );
    const otherConversation = await mutatingIdempotencyKey(
      "sink_write",
      { title: `${"a".repeat(90)} first` },
      "principal-alice-c-2-t1",
    );
    expect(new Set([first, second, otherConversation])).toHaveLength(3);
    expect(first).toMatch(/^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$/);
  });

  it("requires sequential execution for mutating tools", () => {
    expect(toolPolicy("create_draft").executionMode).toBe("sequential");
    expect(toolPolicy("send_email").executionMode).toBe("sequential");
  });

  it("rechecks the stored binding before a resumed side effect", async () => {
    const stored = approvalFromAttempt({
      principalId: policyPrincipal.id,
      conversationId: "c-1",
      tool: "create_draft",
      args: { title: "alpha" },
      idempotencyKey: "draft-alpha",
      expiresAt: 10_000,
    });
    const drafts: string[] = [];
    const refused = await resumeAfterApproval({
      stored,
      incoming: { ...stored, argumentFingerprint: argumentFingerprint({ title: "tampered" }) },
      now: 1,
      effect: () => drafts.push("alpha"),
    });
    expect(refused).toEqual({ resumed: false, reason: "approval does not match stored binding" });
    expect(drafts).toEqual([]);
    const allowed = await resumeAfterApproval({
      stored,
      incoming: stored,
      now: 1,
      effect: () => drafts.push("alpha"),
    });
    expect(allowed).toEqual({ resumed: true, result: 1 });
    expect(drafts).toEqual(["alpha"]);
  });
});

describe("budgets", () => {
  it("stops after the turn limit", () => {
    const budgets = new BudgetTracker();
    for (let i = 0; i < AGENT_BUDGETS.maxTurns - 1; i += 1) {
      budgets.noteTurn();
    }
    expect(budgets.turns).toBe(AGENT_BUDGETS.maxTurns - 1);
    expect(() => budgets.noteTurn()).toThrow(BudgetExceededError);
    expect(budgets.turns).toBe(AGENT_BUDGETS.maxTurns);
  });

  it("stops when cumulative token totals exceed the budget before the next turn", () => {
    const budgets = new BudgetTracker();
    budgets.assertTokenTotals(AGENT_BUDGETS.maxInputTokens, 1);
    expect(() => budgets.assertTokenTotals(AGENT_BUDGETS.maxInputTokens + 1, 1)).toThrow(
      /token budget exhausted/,
    );
  });

  it("does not count prior-run assistant usage against the current execution budget", () => {
    const prior = fauxAssistantMessage("prior answer");
    prior.usage = {
      ...prior.usage,
      input: AGENT_BUDGETS.maxInputTokens,
      output: AGENT_BUDGETS.maxOutputTokens,
      totalTokens: AGENT_BUDGETS.maxInputTokens + AGENT_BUDGETS.maxOutputTokens,
    };
    const current = fauxAssistantMessage("current answer");
    current.usage = { ...current.usage, input: 12, output: 4, totalTokens: 16 };
    expect(currentRunAssistantTokens([prior, current], 1)).toEqual({ input: 12, output: 4 });
  });

  it("counts every native HTTP MCP plugin mutating and search tool once", () => {
    const budgets = new BudgetTracker();
    const names = [
      "search_knowledge",
      "fetch_allowlisted_http",
      "mcp_lookup",
      "plugin_echo",
      "mcp_create_ticket",
      "action_sink_write",
      "search_knowledge",
      "create_draft",
    ];
    for (const name of names) {
      budgets.noteToolCall(name);
    }
    expect(budgets.toolCalls).toBe(8);
    expect(budgets.searchKnowledgeCalls).toBe(2);
    expect(() => budgets.noteToolCall("plugin_echo")).toThrow(/tool-call budget exhausted/);
  });

  it("keeps the four-call search_knowledge limit beside the total cap", () => {
    const budgets = new BudgetTracker();
    for (let index = 0; index < 4; index += 1) {
      budgets.noteToolCall("search_knowledge");
    }
    expect(budgets.toolCalls).toBe(4);
    expect(budgets.searchKnowledgeCalls).toBe(4);
    expect(() => budgets.noteToolCall("search_knowledge")).toThrow(/search_knowledge budget exhausted/);
  });

  it("stops when interactive wall time is exhausted", () => {
    const budgets = new BudgetTracker();
    expect(budgets.remainingWallTimeMs(budgets.startedAt + 89_000)).toBe(1_000);
    expect(budgets.remainingWallTimeMs(budgets.startedAt + AGENT_BUDGETS.wallTimeMs + 1)).toBe(0);
    expect(() => budgets.assertWithinWallTime(budgets.startedAt + AGENT_BUDGETS.wallTimeMs + 1)).toThrow(
      /wall time budget exhausted/,
    );
  });
});

describe("Pi knowledge agent", () => {
  it("blocks a registered mutating tool in the host before any side effect", async () => {
    const pipeline = await tinyPipeline();
    const effects: string[] = [];
    const result = await runKnowledgeAgent({
      question: "create a draft",
      searchQuery: "alpha",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-1",
      tools: [
        {
          name: "create_draft",
          label: "Unsafe draft",
          description: "Test tool whose execute path omits the policy gateway.",
          parameters: Type.Object({ query: Type.String() }),
          executionMode: "sequential",
          execute: async (_id, params: unknown) => {
            const query = (params as { query: string }).query;
            effects.push(query);
            return { content: [{ type: "text" as const, text: query }], details: {} };
          },
        },
      ],
    });

    expect(effects).toEqual([]);
    expect(result.pendingApproval).toBe(true);
    expect(result.pendingApprovalBinding).toEqual(
      expect.objectContaining({
        principalId: "principal-alice",
        conversationId: "c-1",
        tool: "create_draft",
        argumentFingerprint: argumentFingerprint({ query: "alpha" }),
      }),
    );
  }, 20_000);

  it("calls search_knowledge, then host-grounds the answer", async () => {
    const pipeline = await tinyPipeline();
    const result = await runKnowledgeAgent({
      question: "how much leave per month",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-1",
    });
    expect(result.finalResponse).not.toBe(BRAIN_MUST_RETRIEVE);
    expect(result.finalResponse).toContain("[1]");
    expect(result.messages.some((message) => message.role === "toolResult" && message.toolName === SEARCH_KNOWLEDGE_TOOL)).toBe(
      true,
    );
    expect(result.promptVersion).toBeTruthy();
    expect(result.model).toBeTruthy();
    const calls = toolCallsFromMessages(result.messages);
    expect(calls).toEqual([
      expect.objectContaining({
        tool: SEARCH_KNOWLEDGE_TOOL,
        status: "ok",
      }),
    ]);
    const reconstructed = snapshotAgentMessages(result.messages);
    expect(reconstructed).toEqual(result.messages);
  }, 20_000);

  it("does not abort a follow-up run because prior assistant usage filled the token budget", async () => {
    const pipeline = await tinyPipeline();
    const prior = [fauxAssistantMessage("Employees accrued leave in a previous run.[1]")];
    prior[0].usage = {
      ...prior[0].usage,
      input: AGENT_BUDGETS.maxInputTokens,
      output: AGENT_BUDGETS.maxOutputTokens,
      totalTokens: AGENT_BUDGETS.maxInputTokens + AGENT_BUDGETS.maxOutputTokens,
    };
    const result = await runKnowledgeAgent({
      question: "how much leave per month",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-1",
      priorMessages: prior,
    });
    expect(result.aborted).toBe(false);
    expect(result.finalResponse).not.toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    expect(result.finalResponse).toContain("[1]");
  }, 20_000);

  it("persists byte-bounded redacted tool results instead of raw secrets", async () => {
    const pipeline = await tinyPipeline();
    const secret = "Bearer supersecret.token-value";
    const result = await runKnowledgeAgent({
      question: "echo a connector payload",
      searchQuery: "echo",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-1",
      tools: [
        {
          name: "plugin_echo",
          label: "Echo",
          description: "Returns a secret-bearing payload.",
          parameters: Type.Object({ query: Type.String() }),
          execute: async () => ({
            content: [{ type: "text" as const, text: `UNTRUSTED_CONNECTOR_RESULT\n${secret}` }],
            details: { raw: secret },
          }),
        },
      ],
    });
    const calls = toolCallsFromMessages(result.messages);
    expect(calls[0]?.redactedResult).toBe(redactToolResultForStorage(`UNTRUSTED_CONNECTOR_RESULT\n${secret}`));
    expect(calls[0]?.redactedResult).not.toContain("supersecret.token-value");
    expect(calls[0]?.redactedResult).toContain("Bearer [REDACTED]");
  }, 20_000);

  it("cancels an in-flight run", async () => {
    const pipeline = await tinyPipeline();
    const abort = new AbortController();
    abort.abort();
    const result = await runKnowledgeAgent({
      question: "how much leave per month",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-1",
      abort,
    });
    expect(result.aborted || result.errorMessage).toBeTruthy();
  }, 20_000);

  it("host-grounds a tool error as knowledge unavailable", async () => {
    const result = await runKnowledgeAgent({
      question: "how much leave per month",
      pipeline: {
        search: async () => {
          throw new Error("retrieval backend failed");
        },
      },
      principal,
      policyPrincipal,
      conversationId: "c-1",
    });
    expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
  }, 20_000);

  it("ends a mutating tool at pending_approval without executing the side effect", async () => {
    const executor = new IdempotentExecutor(new MemoryIdempotencyStore());
    const drafts: string[] = [];
    const tool = createDraftTool({
      principal: policyPrincipal,
      conversationId: "c-1",
      executor,
      drafts,
    });
    const result = await tool.execute("t1", { title: "alpha" });
    expect(result.details.pendingApproval).toBe(true);
    expect(result.terminate).toBe(true);
    expect(drafts).toEqual([]);
  });

  it("stops the Pi loop at pending_approval without a waiter", async () => {
    const executor = new IdempotentExecutor(new MemoryIdempotencyStore());
    const drafts: string[] = [];
    const tool = createDraftTool({
      principal: policyPrincipal,
      conversationId: "c-1",
      executor,
      drafts,
    });
    const faux = fauxProvider({ provider: "useful-brain-phase5-preview" });
    faux.setResponses([
      fauxAssistantMessage([fauxText("Drafting."), fauxToolCall("create_draft", { title: "alpha" })], {
        stopReason: "toolUse",
      }),
    ]);
    const agent = new Agent({
      initialState: {
        systemPrompt: "Preview only.",
        model: faux.getModel(),
        tools: [tool],
        messages: [],
      },
      streamFn: (nextModel, context, streamOptions) =>
        faux.provider.streamSimple(nextModel, context, streamOptions),
      toolExecution: "sequential",
    });
    await agent.prompt("create a draft");
    await agent.waitForIdle();
    expect(drafts).toEqual([]);
    expect(agent.state.isStreaming).toBe(false);
    expect(toolCallsFromMessages(agent.state.messages).some((call) => call.status === "pending_approval")).toBe(
      true,
    );
  }, 20_000);

  it("never executes high-risk delete_records", async () => {
    const tool = createDeleteRecordsTool({ principal: policyPrincipal, conversationId: "c-1" });
    const result = await tool.execute("t1", { recordId: "rec-1" });
    expect(result.content[0]).toEqual({
      type: "text",
      text: "high-risk actions are denied in the first release",
    });
  });

  it("blocks the ninth mixed tool call in the central beforeToolCall barrier", async () => {
    const budgets = new BudgetTracker();
    const executed: string[] = [];
    const names = [
      "search_knowledge",
      "fetch_allowlisted_http",
      "mcp_lookup",
      "plugin_echo",
      "mcp_create_ticket",
      "action_sink_write",
      "search_knowledge",
      "create_draft",
      "plugin_echo",
    ];
    const tools = [...new Set(names)].map((name) => ({
      name,
      label: name,
      description: "budget probe",
      parameters: Type.Object({ query: Type.String() }),
      execute: async () => {
        executed.push(name);
        return { content: [{ type: "text" as const, text: "ok" }], details: {} };
      },
    }));
    const faux = fauxProvider({ provider: "useful-brain-budget-barrier" });
    faux.setResponses([
      ...names.map((name, index) =>
        fauxAssistantMessage([fauxText(`call-${index}`), fauxToolCall(name, { query: String(index) })], {
          stopReason: "toolUse",
        }),
      ),
      fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
    ]);
    const agent = new Agent({
      initialState: {
        systemPrompt: "Call tools.",
        model: faux.getModel(),
        tools,
        messages: [],
      },
      streamFn: (nextModel, context, streamOptions) =>
        faux.provider.streamSimple(nextModel, context, streamOptions),
      toolExecution: "sequential",
      beforeToolCall: async (context) => {
        try {
          budgets.noteToolCall(context.toolCall.name);
          return undefined;
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { block: true, reason: error.message, terminate: true };
          }
          throw error;
        }
      },
    });
    await agent.prompt("go");
    await agent.waitForIdle();
    expect(executed).toEqual(names.slice(0, 8));
    expect(budgets.toolCalls).toBe(9);
    expect(budgets.searchKnowledgeCalls).toBe(2);
  }, 20_000);
});
