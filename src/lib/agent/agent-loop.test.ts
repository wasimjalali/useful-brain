import { describe, expect, it, vi } from "vitest";
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
  identifierTokens,
  isMultiPartQuestion,
  LIVE_KNOWLEDGE_SYSTEM_PROMPT,
  runKnowledgeAgent,
  snapshotAgentMessages,
  toolCallsFromMessages,
} from "./run";
import { createSearchKnowledgeTool } from "./search-knowledge";
import { ExtractionTruncatedError } from "./extraction-truncated";
import { redactToolResultForStorage } from "./redact-tool-result";
import { createWorkersAiCitationRepair } from "../models/workers-ai-citation-repair";
import {
  BRAIN_KNOWLEDGE_UNAVAILABLE,
  BRAIN_MUST_RETRIEVE,
  BRAIN_NOT_ENOUGH_EVIDENCE,
  SEARCH_KNOWLEDGE_TOOL,
} from "./host-grounding";

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
  it("requires exact current-turn evidence spans in the live prompt", () => {
    expect(LIVE_KNOWLEDGE_SYSTEM_PROMPT).toContain("shortest exact sentence");
    expect(LIVE_KNOWLEDGE_SYSTEM_PROMPT).toContain("citation label from this turn");
    expect(LIVE_KNOWLEDGE_SYSTEM_PROMPT).toContain("dedicated policy document");
    expect(LIVE_KNOWLEDGE_SYSTEM_PROMPT).toContain("is not an answer");
    expect(LIVE_KNOWLEDGE_SYSTEM_PROMPT).toContain("not evidence for a different process");
    expect(LIVE_KNOWLEDGE_SYSTEM_PROMPT).toContain("Follow attribution pointers");
  });

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

  it("completes a citation-free verbatim draft without calling the repair model", async () => {
    const pipeline = await tinyPipeline();
    const faux = fauxProvider({ provider: "useful-brain-citation-complete" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "leave" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Employees accrue 1.5 days of leave per month.")], {
        stopReason: "stop",
      }),
    ]);
    const repairGroundedAnswer = vi.fn();

    const result = await runKnowledgeAgent({
      question: "How much leave accrues each month?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-complete",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) =>
          faux.provider.streamSimple(model, context, options),
        repairGroundedAnswer,
      },
    });

    expect(repairGroundedAnswer).not.toHaveBeenCalled();
    expect(result.finalResponse).toBe("Employees accrue 1.5 days of leave per month.[1]");
  }, 20_000);

  it("repairs a paraphrased draft against the current-turn evidence", async () => {
    const pipeline = await tinyPipeline();
    const faux = fauxProvider({ provider: "useful-brain-citation-repair" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "leave" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Staff members gain 1.5 leave days every month.")], {
        stopReason: "stop",
      }),
    ]);
    const repairGroundedAnswer = vi
      .fn()
      .mockResolvedValue("Employees accrue 1.5 days of leave per month.[1]");

    const result = await runKnowledgeAgent({
      question: "How much leave accrues each month?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-repair",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) =>
          faux.provider.streamSimple(model, context, options),
        repairGroundedAnswer,
      },
    });

    expect(repairGroundedAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "How much leave accrues each month?",
        evidence: [expect.objectContaining({ citationLabel: "[1]" })],
      }),
    );
    expect(result.finalResponse).toBe("Employees accrue 1.5 days of leave per month.[1]");
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

  it("discards search results that land after the run aborts", async () => {
    const pipeline = await tinyPipeline();
    const abort = new AbortController();
    const seenSignals: Array<AbortSignal | undefined> = [];
    const result = await runKnowledgeAgent({
      question: "how much leave per month",
      pipeline: {
        search: (input) => {
          seenSignals.push(input.signal);
          abort.abort();
          return pipeline.search(input);
        },
      },
      principal,
      policyPrincipal,
      conversationId: "c-late-search",
      abort,
    });

    // The composed deadline signal reaches the pipeline, but the abort wins
    // the race: no hit is appended to the evidence ledger.
    expect(seenSignals[0]?.aborted).toBe(true);
    expect(result.aborted).toBe(true);
    expect(result.evidence).toEqual([]);
  }, 20_000);

  it("never starts a second repair call after an abort lands", async () => {
    const pipeline = await tinyPipeline();
    const abort = new AbortController();
    const faux = fauxProvider({ provider: "useful-brain-abort-repair" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "leave" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Staff members gain 1.5 leave days every month.")], {
        stopReason: "stop",
      }),
    ]);
    const repairGroundedAnswer = vi.fn().mockImplementation(async () => {
      abort.abort();
      return "Employees accrue 1.5 days of leave per month.[1]";
    });

    const result = await runKnowledgeAgent({
      question: "How much leave accrues each month?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-abort-repair",
      abort,
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) =>
          faux.provider.streamSimple(model, context, options),
        repairGroundedAnswer,
      },
    });

    // The late repair result is not adopted and no further repair, recovery
    // or coverage call starts once the run is cancelled.
    expect(repairGroundedAnswer).toHaveBeenCalledTimes(1);
    expect(result.aborted).toBe(true);
    expect(result.finalResponse).not.toBe(
      "Employees accrue 1.5 days of leave per month.[1]",
    );
  }, 20_000);

  it("keeps the final answer and tool accounting when transcript capture is disabled", async () => {
    const pipeline = await tinyPipeline();
    const result = await runKnowledgeAgent({
      question: "how much leave per month",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-nosnap",
      captureMessages: false,
    });

    expect(result.finalResponse).toContain("[1]");
    expect(result.messages).toEqual([]);
    expect(result.aborted).toBe(false);
    expect(result.pendingApproval).toBe(false);
    expect(result.evidence.length).toBeGreaterThan(0);
  }, 20_000);

  it("keeps approval accounting when transcript capture is disabled", async () => {
    const pipeline = await tinyPipeline();
    const result = await runKnowledgeAgent({
      question: "create a draft",
      searchQuery: "alpha",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-nosnap-approval",
      captureMessages: false,
      tools: [
        {
          name: "create_draft",
          label: "Unsafe draft",
          description: "Test tool whose execute path omits the policy gateway.",
          parameters: Type.Object({ query: Type.String() }),
          executionMode: "sequential",
          execute: async () => ({
            content: [{ type: "text" as const, text: "draft" }],
            details: {},
          }),
        },
      ],
    });

    expect(result.messages).toEqual([]);
    expect(result.pendingApproval).toBe(true);
    expect(result.pendingApprovalBinding).toEqual(
      expect.objectContaining({
        principalId: "principal-alice",
        tool: "create_draft",
      }),
    );
  }, 20_000);

  it("keeps captured snapshots detached from the evidence ledger", async () => {
    const pipeline = await tinyPipeline();
    const result = await runKnowledgeAgent({
      question: "how much leave per month",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-detached",
    });

    const toolResult = result.messages.find((message) => message.role === "toolResult");
    expect(toolResult).toBeTruthy();
    if (toolResult && Array.isArray(toolResult.content)) {
      const part = toolResult.content[0];
      if (part && part.type === "text") {
        part.text = "tampered after the fact";
      }
    }

    expect(result.evidence[0]?.text).toBe(
      "Employees accrue 1.5 days of leave per month.",
    );
    expect(result.finalResponse).toContain("[1]");
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

async function escalationPipeline() {
  const store = new MemoryChunkStore();
  const embedder = new FakeEmbeddingProvider(8);
  const texts = [
    "Billing disputes open more than 30 days move to ESC-3.",
    "ESC-3 complaints are owned by the VP of Support.",
  ];
  const embeddings = await embedder.embedTexts(texts);
  store.upsert(
    texts.map((content, index) => ({
      chunkId: `escalation__body__00${index}`,
      documentId: index === 0 ? "invoicing" : "complaint-escalation",
      title: index === 0 ? "Invoicing" : "Complaint Escalation",
      sourceName: index === 0 ? "Invoicing" : "Complaint Escalation",
      sourcePath: index === 0 ? "invoicing.md" : "complaint-escalation.md",
      sectionHeading: index === 0 ? "Billing Disputes" : "ESC-3: VP Support",
      content,
      chunkIndex: 0,
      charStart: 0,
      charEnd: content.length,
      accessScope: "public" as const,
      allowedRoles: [],
      allowedDepartments: [],
      ownerUserId: "",
      embedding: embeddings[index],
    })),
  );
  return new KnowledgePipeline({ store, embedder });
}

describe("abstention and citation discipline", () => {
  it("rechecks an abstention with one strict quote pass before refusing", async () => {
    const pipeline = await tinyPipeline();
    const faux = fauxProvider({ provider: "useful-brain-abstain" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "stock purchase plan" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxText("The retrieved documents do not contain any information about a stock purchase plan.")],
        { stopReason: "stop" },
      ),
    ]);
    // The recheck repair model finds no evidence quote answering the
    // question, so the refusal stands.
    const repairGroundedAnswer = vi.fn().mockResolvedValue(null);

    const result = await runKnowledgeAgent({
      question: "Does the company offer a stock purchase plan?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-abstain",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
        repairGroundedAnswer,
      },
    });

    expect(result.finalResponse).toBe(BRAIN_NOT_ENOUGH_EVIDENCE);
    expect(result.refusalReason).toBe("model_abstained_with_evidence");
    expect(repairGroundedAnswer).toHaveBeenCalledTimes(1);
    expect(repairGroundedAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ lexicalFallback: false }),
    );
  }, 20_000);

  it("recovers an over-refused question with an evidence-verbatim recheck quote", async () => {
    const pipeline = await tinyPipeline();
    const faux = fauxProvider({ provider: "useful-brain-abstain-recover" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "leave accrual" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxText("The retrieved documents do not state how much leave accrues per month.")],
        { stopReason: "stop" },
      ),
    ]);
    const repairGroundedAnswer = vi
      .fn()
      .mockResolvedValue("Employees accrue 1.5 days of leave per month.[1]");

    const result = await runKnowledgeAgent({
      question: "How many days of leave do employees accrue per month?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-abstain-recover",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
        repairGroundedAnswer,
      },
    });

    expect(result.finalResponse).toBe("Employees accrue 1.5 days of leave per month.[1]");
    expect(result.refusalReason).toBeUndefined();
    expect(repairGroundedAnswer).toHaveBeenCalledTimes(1);
    expect(repairGroundedAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ lexicalFallback: false }),
    );
  }, 20_000);

  it("completes the citation for a verbatim second hop before any model repair", async () => {
    const pipeline = await escalationPipeline();
    const faux = fauxProvider({ provider: "useful-brain-second-hop" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "billing dispute complaint" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [
          fauxText(
            "Billing disputes open more than 30 days move to ESC-3.[1] ESC-3 complaints are owned by the VP of Support.",
          ),
        ],
        { stopReason: "stop" },
      ),
    ]);
    const repairGroundedAnswer = vi.fn();

    const result = await runKnowledgeAgent({
      question: "How do billing disputes and complaints interact?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-second-hop",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
        repairGroundedAnswer,
      },
    });

    expect(result.finalResponse).toContain("VP of Support.[2]");
    expect(result.finalResponse).toContain("[1]");
    expect(repairGroundedAnswer).not.toHaveBeenCalled();
  }, 20_000);

  it("recovers an abstained identifier lookup with a strict exact-quote retry", async () => {
    const store = new MemoryChunkStore();
    const embedder = new FakeEmbeddingProvider(8);
    const text = "ERR-7702 means the export queue is stalled.";
    const embeddings = await embedder.embedTexts([text]);
    store.upsert([
      {
        chunkId: "errors__body__000",
        documentId: "error-codes",
        title: "Error Codes",
        sourceName: "Error Codes",
        sourcePath: "error-codes.md",
        sectionHeading: "Export Errors",
        content: text,
        chunkIndex: 0,
        charStart: 0,
        charEnd: text.length,
        accessScope: "public",
        allowedRoles: [],
        allowedDepartments: [],
        ownerUserId: "",
        embedding: embeddings[0],
      },
    ]);
    const pipeline = new KnowledgePipeline({ store, embedder });
    const faux = fauxProvider({ provider: "useful-brain-identifier" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "ERR-7702" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("The evidence does not mention this error code.")], {
        stopReason: "stop",
      }),
    ]);
    const repairGroundedAnswer = vi
      .fn()
      .mockResolvedValue("ERR-7702 means the export queue is stalled.[1]");

    const result = await runKnowledgeAgent({
      question: "What does error code ERR-7702 indicate?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-identifier",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
        repairGroundedAnswer,
      },
    });

    expect(repairGroundedAnswer).toHaveBeenCalledTimes(1);
    expect(repairGroundedAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ strictTokens: ["ERR-7702"] }),
    );
    expect(result.finalResponse).toBe("ERR-7702 means the export queue is stalled.[1]");
    expect(result.refusalReason).toBeUndefined();
  }, 20_000);

  it("extracts identifier-like tokens only", () => {
    expect(identifierTokens("What does error code ERR-7702 indicate?")).toEqual(["ERR-7702"]);
    expect(identifierTokens("What does Clause 7.3(b) commit us to?")).toEqual(["7.3(b)"]);
    expect(identifierTokens("A dispute open for 35 days was escalated")).toEqual([]);
  });

  it("never salvages a refusal that quotes an off-topic evidence sentence", async () => {
    const pipeline = await tinyPipeline();
    const faux = fauxProvider({ provider: "useful-brain-refusal-quote" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "stock purchase plan" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [
          fauxText(
            'The retrieved documents do not mention a stock purchase plan. The closest text is: "Employees accrue 1.5 days of leave per month."',
          ),
        ],
        { stopReason: "stop" },
      ),
    ]);

    const result = await runKnowledgeAgent({
      question: "Does the company offer a stock purchase plan?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-refusal-quote",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
      },
    });

    expect(result.finalResponse).toBe(BRAIN_NOT_ENOUGH_EVIDENCE);
    expect(result.refusalReason).toBe("model_abstained_with_evidence");
  }, 20_000);

  it("keeps a long marker-free refusal a refusal even when it quotes evidence", async () => {
    const pipeline = await tinyPipeline();
    const faux = fauxProvider({ provider: "useful-brain-long-refusal" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "stock purchase plan" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [
          fauxText(
            'The retrieved documents do not mention an employee stock purchase plan anywhere in the corpus, and I checked every retrieved passage carefully before concluding this, so I cannot answer the question as asked. The closest text I found is: "Employees accrue 1.5 days of leave per month."',
          ),
        ],
        { stopReason: "stop" },
      ),
    ]);

    const result = await runKnowledgeAgent({
      question: "Does the company offer a stock purchase plan?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-long-refusal",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
      },
    });

    expect(result.finalResponse).not.toContain("1.5 days of leave");
  }, 20_000);

  it("recovers an identifier lookup when citation repair cannot ground a paraphrased draft", async () => {
    const store = new MemoryChunkStore();
    const embedder = new FakeEmbeddingProvider(8);
    const text = "ERR-7702 means the export queue is stalled.";
    const embeddings = await embedder.embedTexts([text]);
    store.upsert([
      {
        chunkId: "errors__body__000",
        documentId: "error-codes",
        title: "Error Codes",
        sourceName: "Error Codes",
        sourcePath: "error-codes.md",
        sectionHeading: "Export Errors",
        content: text,
        chunkIndex: 0,
        charStart: 0,
        charEnd: text.length,
        accessScope: "public",
        allowedRoles: [],
        allowedDepartments: [],
        ownerUserId: "",
        embedding: embeddings[0],
      },
    ]);
    const pipeline = new KnowledgePipeline({ store, embedder });
    const faux = fauxProvider({ provider: "useful-brain-identifier-invalid" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "ERR-7702" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxText("ERR-7702 signals that the export queue pipeline has become stuck.")],
        { stopReason: "stop" },
      ),
    ]);
    const repairGroundedAnswer = vi
      .fn()
      .mockImplementation(async ({ strictTokens }: { strictTokens?: string[] }) =>
        strictTokens ? "ERR-7702 means the export queue is stalled.[1]" : null,
      );

    const result = await runKnowledgeAgent({
      question: "What does error code ERR-7702 indicate?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-identifier-invalid",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
        repairGroundedAnswer,
      },
    });

    expect(repairGroundedAnswer).toHaveBeenCalledTimes(2);
    expect(repairGroundedAnswer).toHaveBeenLastCalledWith(
      expect.objectContaining({ strictTokens: ["ERR-7702"] }),
    );
    expect(result.finalResponse).toBe("ERR-7702 means the export queue is stalled.[1]");
    expect(result.refusalReason).toBeUndefined();
  }, 20_000);

  it("reuses one provider extraction across the strict retry and the abstention recheck", async () => {
    const store = new MemoryChunkStore();
    const embedder = new FakeEmbeddingProvider(8);
    const text = "Export stalls page the on-call engineer. ERR-7702 means the export queue is stalled.";
    const embeddings = await embedder.embedTexts([text]);
    store.upsert([
      {
        chunkId: "errors__body__000",
        documentId: "error-codes",
        title: "Error Codes",
        sourceName: "Error Codes",
        sourcePath: "error-codes.md",
        sectionHeading: "Export Errors",
        content: text,
        chunkIndex: 0,
        charStart: 0,
        charEnd: text.length,
        accessScope: "public",
        allowedRoles: [],
        allowedDepartments: [],
        ownerUserId: "",
        embedding: embeddings[0],
      },
    ]);
    const pipeline = new KnowledgePipeline({ store, embedder });
    const faux = fauxProvider({ provider: "useful-brain-extraction-reuse" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "ERR-7702" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("The evidence does not mention this error code.")], {
        stopReason: "stop",
      }),
    ]);
    // The strict retry rejects this extraction (the quote lacks ERR-7702);
    // the abstention recheck accepts the same quote with no token filter.
    // Without run-local extraction reuse this costs two identical ai.run
    // calls.
    const run = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              quotes: [
                { quote: "Export stalls page the on-call engineer.", citation: "[1]" },
              ],
            }),
          },
        },
      ],
    });
    const repair = createWorkersAiCitationRepair({ run });
    const repairGroundedAnswer = vi.fn(
      (input: Parameters<typeof repair>[0]) => repair(input),
    );

    const result = await runKnowledgeAgent({
      question: "What does error code ERR-7702 indicate?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-extraction-reuse",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) =>
          faux.provider.streamSimple(model, context, options),
        repairGroundedAnswer,
      },
    });

    // Both repair passes ran (strict retry, then abstention recheck) but one
    // run-local extraction fed them.
    expect(repairGroundedAnswer).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.finalResponse).toBe("Export stalls page the on-call engineer. [1]");
    expect(result.refusalReason).toBeUndefined();
  }, 20_000);
});

describe("multi-part coverage pass", () => {
  it("detects multi-part questions", () => {
    expect(isMultiPartQuestion("What process applies and who approves it?")).toBe(true);
    expect(isMultiPartQuestion("How do the two processes interact?")).toBe(true);
    expect(isMultiPartQuestion("What are both numbers?")).toBe(true);
    expect(isMultiPartQuestion("What is the refund window?")).toBe(false);
    // Narrative "and" in the scenario must not trigger on a one-fact trap.
    expect(
      isMultiPartQuestion(
        "I am an employee and my expense report was approved on Monday. When will it be paid?",
      ),
    ).toBe(false);
    // A plural-set question triggers even when "and" sits in the preamble.
    expect(
      isMultiPartQuestion(
        "A customer received a refund and wants their data deleted. What timelines apply?",
      ),
    ).toBe(true);
    // Two interrogative sentences are themselves a multi-part signal.
    expect(isMultiPartQuestion("What is the refund window? Also, who approves it?")).toBe(true);
  });

  it("covers the unanswered second part of a multi-part question with a verbatim quote", async () => {
    const pipeline = await escalationPipeline();
    const faux = fauxProvider({ provider: "useful-brain-coverage" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "billing dispute complaint" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxText("Billing disputes open more than 30 days move to ESC-3.[1]")],
        { stopReason: "stop" },
      ),
    ]);
    const coverAnswerParts = vi
      .fn()
      .mockResolvedValue("ESC-3 complaints are owned by the VP of Support. [2]");

    const result = await runKnowledgeAgent({
      question: "How do billing disputes and complaints interact?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-coverage",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
        coverAnswerParts,
      },
    });

    expect(coverAnswerParts).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "How do billing disputes and complaints interact?",
        draft: "Billing disputes open more than 30 days move to ESC-3.[1]",
        evidence: [
          expect.objectContaining({ citationLabel: "[1]" }),
          expect.objectContaining({ citationLabel: "[2]" }),
        ],
      }),
    );
    expect(result.finalResponse).toContain("Billing disputes open more than 30 days move to ESC-3.[1]");
    expect(result.finalResponse).toContain("ESC-3 complaints are owned by the VP of Support. [2]");
  }, 20_000);

  it("runs the coverage pass when one cited document answers only one of two asked facts", async () => {
    const store = new MemoryChunkStore();
    const embedder = new FakeEmbeddingProvider(8);
    const texts = [
      "P1 tickets have a first-response target of 1 hour. P2 tickets have a first-response target of 4 hours.",
      "ESC-3 complaints are owned by the VP of Support.",
    ];
    const embeddings = await embedder.embedTexts(texts);
    store.upsert(
      texts.map((content, index) => ({
        chunkId: `targets__body__00${index}`,
        documentId: index === 0 ? "response-targets" : "complaint-escalation",
        title: index === 0 ? "Response Targets" : "Complaint Escalation",
        sourceName: index === 0 ? "Response Targets" : "Complaint Escalation",
        sourcePath: index === 0 ? "response-targets.md" : "complaint-escalation.md",
        sectionHeading: index === 0 ? "Targets" : "ESC-3: VP Support",
        content,
        chunkIndex: 0,
        charStart: 0,
        charEnd: content.length,
        accessScope: "public" as const,
        allowedRoles: [],
        allowedDepartments: [],
        ownerUserId: "",
        embedding: embeddings[index],
      })),
    );
    const pipeline = new KnowledgePipeline({ store, embedder });
    const faux = fauxProvider({ provider: "useful-brain-coverage-same-doc" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "P1 P2 first-response targets" })],
        { stopReason: "toolUse" },
      ),
      // Both facts live in the one cited document; the draft states only the
      // first, so coverage must still run and may re-cite the same label.
      fauxAssistantMessage([fauxText("P1 tickets have a first-response target of 1 hour.[1]")], {
        stopReason: "stop",
      }),
    ]);
    const coverAnswerParts = vi
      .fn()
      .mockResolvedValue("P2 tickets have a first-response target of 4 hours. [1]");

    const result = await runKnowledgeAgent({
      question: "What are the first-response targets for P1 and P2 tickets?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-coverage-same-doc",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
        coverAnswerParts,
      },
    });

    expect(coverAnswerParts).toHaveBeenCalledTimes(1);
    expect(result.finalResponse).toContain("P1 tickets have a first-response target of 1 hour.[1]");
    expect(result.finalResponse).toContain("P2 tickets have a first-response target of 4 hours. [1]");
  }, 20_000);

  it("skips the coverage pass for a single-part question with no pointer hints", async () => {
    const pipeline = await escalationPipeline();
    const faux = fauxProvider({ provider: "useful-brain-coverage-single" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "billing dispute" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxText("Billing disputes open more than 30 days move to ESC-3.[1]")],
        { stopReason: "stop" },
      ),
    ]);
    const coverAnswerParts = vi.fn();

    const result = await runKnowledgeAgent({
      question: "When do billing disputes escalate to ESC-3?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-coverage-single",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
        coverAnswerParts,
      },
    });

    expect(coverAnswerParts).not.toHaveBeenCalled();
    expect(result.finalResponse).toBe("Billing disputes open more than 30 days move to ESC-3.[1]");
  }, 20_000);

  it("runs coverage for a single-part draft that ignores a pointed-to document", async () => {
    const store = new MemoryChunkStore();
    const embedder = new FakeEmbeddingProvider(8);
    const texts = [
      "Billing disputes open more than 30 days move to ESC-3 under the Complaint Escalation process.",
      "ESC-3 complaints are owned by the VP of Support.",
    ];
    const embeddings = await embedder.embedTexts(texts);
    store.upsert(
      texts.map((content, index) => ({
        chunkId: `pointer__body__00${index}`,
        documentId: index === 0 ? "invoicing" : "complaint-escalation",
        title: index === 0 ? "Invoicing" : "Complaint Escalation",
        sourceName: index === 0 ? "Invoicing" : "Complaint Escalation",
        sourcePath: index === 0 ? "invoicing.md" : "complaint-escalation.md",
        sectionHeading: index === 0 ? "Billing Disputes" : "ESC-3: VP Support",
        content,
        chunkIndex: 0,
        charStart: 0,
        charEnd: content.length,
        accessScope: "public" as const,
        allowedRoles: [],
        allowedDepartments: [],
        ownerUserId: "",
        embedding: embeddings[index],
      })),
    );
    const pipeline = new KnowledgePipeline({ store, embedder });
    const faux = fauxProvider({ provider: "useful-brain-coverage-pointer" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "billing dispute escalation" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxText("Billing disputes open more than 30 days move to ESC-3 under the Complaint Escalation process.[1]")],
        { stopReason: "stop" },
      ),
    ]);
    const coverAnswerParts = vi
      .fn()
      .mockResolvedValue("ESC-3 complaints are owned by the VP of Support. [2]");

    const result = await runKnowledgeAgent({
      question: "When do billing disputes escalate to ESC-3?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-coverage-pointer",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
        coverAnswerParts,
      },
    });

    expect(isMultiPartQuestion("When do billing disputes escalate to ESC-3?")).toBe(false);
    expect(coverAnswerParts).toHaveBeenCalledTimes(1);
    expect(result.finalResponse).toContain("under the Complaint Escalation process.[1]");
    expect(result.finalResponse).toContain("ESC-3 complaints are owned by the VP of Support. [2]");
  }, 20_000);

  it("keeps the draft when coverage additions fail grounding", async () => {
    const pipeline = await escalationPipeline();
    const faux = fauxProvider({ provider: "useful-brain-coverage-invalid" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "billing dispute complaint" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxText("Billing disputes open more than 30 days move to ESC-3.[1]")],
        { stopReason: "stop" },
      ),
    ]);
    const coverAnswerParts = vi.fn().mockResolvedValue("A fabricated approval claim.[2]");

    const result = await runKnowledgeAgent({
      question: "How do billing disputes and complaints interact?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-coverage-invalid",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
        coverAnswerParts,
      },
    });

    expect(coverAnswerParts).toHaveBeenCalledTimes(1);
    expect(result.finalResponse).toBe("Billing disputes open more than 30 days move to ESC-3.[1]");
  }, 20_000);

  // A truncated coverage call must keep the draft (as any failed call does)
  // and be counted, so the turn can report that the second look never ran.
  it("keeps the draft and counts a truncated coverage call", async () => {
    const pipeline = await escalationPipeline();
    const faux = fauxProvider({ provider: "useful-brain-coverage-truncated" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "billing dispute complaint" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxText("Billing disputes open more than 30 days move to ESC-3.[1]")],
        { stopReason: "stop" },
      ),
    ]);
    const coverAnswerParts = vi.fn().mockRejectedValue(new ExtractionTruncatedError("coverage"));

    const result = await runKnowledgeAgent({
      question: "How do billing disputes and complaints interact?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-coverage-truncated",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
        coverAnswerParts,
      },
    });

    expect(coverAnswerParts).toHaveBeenCalledTimes(1);
    expect(result.finalResponse).toBe("Billing disputes open more than 30 days move to ESC-3.[1]");
    expect(result.extractionTruncatedCount).toBe(1);
  }, 20_000);

  it("never runs coverage on a refusal", async () => {
    const pipeline = await escalationPipeline();
    const faux = fauxProvider({ provider: "useful-brain-coverage-refusal" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "stock purchase plan" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxText("The retrieved documents do not contain any information about a stock purchase plan.")],
        { stopReason: "stop" },
      ),
    ]);
    const coverAnswerParts = vi.fn();

    const result = await runKnowledgeAgent({
      question: "Does the company offer a stock purchase plan and a bonus plan?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-coverage-refusal",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
        coverAnswerParts,
      },
    });

    expect(coverAnswerParts).not.toHaveBeenCalled();
    expect(result.finalResponse).toBe(BRAIN_NOT_ENOUGH_EVIDENCE);
  }, 20_000);
});

describe("evidence presentation", () => {
  it("presents document identity before the chunk text in search results", async () => {
    const pipeline = await tinyPipeline();
    const budgets = new BudgetTracker();
    const tool = createSearchKnowledgeTool({
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-shape",
      budgets,
    });
    const result = await tool.execute("call-1", { query: "leave" }, undefined as never);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    const payload = JSON.parse(text.replace(/^UNTRUSTED_EVIDENCE\n/, "")) as {
      hits: Array<Record<string, unknown>>;
    };
    expect(payload.hits[0]?.document).toBe("Leave Policy");
    expect(payload.hits[0]?.section).toBe("Leave");
    expect(text.indexOf('"document"')).toBeGreaterThan(-1);
    expect(text.indexOf('"document"')).toBeLessThan(text.indexOf('"content"'));
  }, 20_000);
});

describe("review regressions", () => {
  async function negativePolicyPipeline() {
    const store = new MemoryChunkStore();
    const embedder = new FakeEmbeddingProvider(8);
    const texts = [
      "This document does not cover contractor travel under DOC-4412.",
      "DOC-4412 reimburses employee mileage at the published federal rate.",
    ];
    const embeddings = await embedder.embedTexts(texts);
    store.upsert(
      texts.map((content, index) => ({
        chunkId: `doc4412__body__00${index}`,
        documentId: "doc-4412",
        title: "Travel Policy",
        sourceName: "Travel Policy",
        sourcePath: "travel-policy.md",
        sectionHeading: index === 0 ? "Exclusions" : "Mileage",
        content,
        chunkIndex: index,
        charStart: 0,
        charEnd: content.length,
        accessScope: "public" as const,
        allowedRoles: [],
        allowedDepartments: [],
        ownerUserId: "",
        embedding: embeddings[index],
      })),
    );
    return new KnowledgePipeline({ store, embedder });
  }

  it("keeps a grounded answer that quotes a negative policy sentence", async () => {
    const pipeline = await negativePolicyPipeline();
    const faux = fauxProvider({ provider: "useful-brain-negative-quote" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "DOC-4412 contractor travel" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxText("This document does not cover contractor travel under DOC-4412.[1]")],
        { stopReason: "stop" },
      ),
    ]);
    const repairGroundedAnswer = vi
      .fn()
      .mockResolvedValue("DOC-4412 reimburses employee mileage at the published federal rate.[2]");

    const result = await runKnowledgeAgent({
      question: "Does DOC-4412 cover contractor travel?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-negative-quote",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
        repairGroundedAnswer,
      },
    });

    expect(result.finalResponse).toBe(
      "This document does not cover contractor travel under DOC-4412.[1]",
    );
    expect(result.refusalReason).toBeUndefined();
    expect(repairGroundedAnswer).not.toHaveBeenCalled();
  }, 20_000);

  it("completes an under-cited marker-free draft instead of refusing it", async () => {
    const pipeline = await negativePolicyPipeline();
    const faux = fauxProvider({ provider: "useful-brain-markerless-draft" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "DOC-4412" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [
          fauxText(
            "This document does not cover contractor travel under DOC-4412. DOC-4412 reimburses employee mileage at the published federal rate.",
          ),
        ],
        { stopReason: "stop" },
      ),
    ]);
    const repairGroundedAnswer = vi.fn();

    const result = await runKnowledgeAgent({
      question: "What does DOC-4412 say about travel?",
      pipeline,
      principal,
      policyPrincipal,
      conversationId: "c-markerless",
      runtime: {
        model: { ...faux.getModel(), api: "openai-completions" },
        stream: (model, context, options) => faux.provider.streamSimple(model, context, options),
        repairGroundedAnswer,
      },
    });

    expect(result.finalResponse).toContain("[1]");
    expect(result.finalResponse).toContain("[2]");
    expect(result.refusalReason).toBeUndefined();
    expect(repairGroundedAnswer).not.toHaveBeenCalled();
  }, 20_000);

  it("normalizes identifier tokens with sentence punctuation and skips decimals", () => {
    expect(identifierTokens("Explain the remediation steps for ERR-7702.")).toEqual(["ERR-7702"]);
    expect(identifierTokens("Is the mileage rate 0.58 per mile?")).toEqual([]);
  });
});

describe("retrieval availability", () => {
  function scriptedRuntime(provider: string, replies: ReturnType<typeof fauxAssistantMessage>[]) {
    const faux = fauxProvider({ provider });
    faux.setResponses(replies);
    return {
      model: { ...faux.getModel(), api: "openai-completions" as const },
      stream: ((model, context, options) =>
        faux.provider.streamSimple(model, context, options)) as NonNullable<
        Parameters<typeof runKnowledgeAgent>[0]["runtime"]
      >["stream"],
    };
  }
  const searchCall = (query: string) =>
    fauxAssistantMessage([fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query })], {
      stopReason: "toolUse",
    });
  const finalText = (text: string) => fauxAssistantMessage([fauxText(text)], { stopReason: "stop" });
  const emptySearch = (query: string, vectorChannelError?: boolean) => ({
    hits: [],
    trace: {
      query,
      finalChunkIds: [],
      vectorScores: {},
      keywordScores: {},
      fusedScores: {},
      rerankScores: {},
      fingerprint: "test",
      ...(vectorChannelError ? { vectorChannelError } : {}),
    },
  });

  it("does not record a refusal written after a failed search as a grounded refusal", async () => {
    // Brownout shape: the backend throws, the model reads {"error":true} and
    // replies with the exact not-enough-evidence sentence it was told to use.
    const result = await runKnowledgeAgent({
      question: "How much leave accrues each month?",
      pipeline: {
        search: async () => {
          throw new Error("D1_ERROR: Network connection lost.");
        },
      },
      principal,
      policyPrincipal,
      conversationId: "c-search-failed-refusal",
      runtime: scriptedRuntime("useful-brain-failed-refusal", [
        searchCall("leave accrual"),
        finalText(BRAIN_NOT_ENOUGH_EVIDENCE),
      ]),
    });

    expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    expect(result.refusalReason).toBeUndefined();
    expect(result.evidence).toEqual([]);
  }, 20_000);

  it("does not let an empty retry hide an earlier failed search", async () => {
    let calls = 0;
    const result = await runKnowledgeAgent({
      question: "How much leave accrues each month?",
      pipeline: {
        search: async ({ query }) => {
          calls += 1;
          if (calls === 1) {
            throw new Error("reranker unavailable");
          }
          return emptySearch(query);
        },
      },
      principal,
      policyPrincipal,
      conversationId: "c-search-failed-then-empty",
      runtime: scriptedRuntime("useful-brain-failed-then-empty", [
        searchCall("leave accrual"),
        searchCall("monthly leave"),
        finalText("The documents do not contain information about monthly leave accrual."),
      ]),
    });

    expect(calls).toBe(2);
    expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    expect(result.refusalReason).toBeUndefined();
  }, 20_000);

  it("fails closed when any search in the turn failed, even beside a grounded draft", async () => {
    const pipeline = await tinyPipeline();
    let calls = 0;
    const repairGroundedAnswer = vi.fn().mockResolvedValue(null);
    const result = await runKnowledgeAgent({
      question: "How much leave accrues each month and who approves it?",
      pipeline: {
        search: async (input) => {
          calls += 1;
          if (calls === 2) {
            throw new Error("search deadline exceeded");
          }
          return pipeline.search(input);
        },
      },
      principal,
      policyPrincipal,
      conversationId: "c-search-partial",
      runtime: {
        ...scriptedRuntime("useful-brain-partial", [
          searchCall("leave accrual"),
          searchCall("leave approver"),
          finalText("Employees accrue 1.5 days of leave per month.[1]"),
        ]),
        repairGroundedAnswer,
      },
    });

    // The second hop never ran, so the answer cannot be trusted as complete.
    expect(calls).toBe(2);
    expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    expect(repairGroundedAnswer).not.toHaveBeenCalled();
  }, 20_000);

  it("treats a search tool that throws inside the agent as unavailable", async () => {
    const result = await runKnowledgeAgent({
      question: "How much leave accrues each month?",
      pipeline: { search: async ({ query }) => emptySearch(query) },
      principal,
      policyPrincipal,
      conversationId: "c-search-tool-throws",
      tools: [
        {
          name: SEARCH_KNOWLEDGE_TOOL,
          label: "Search knowledge",
          description: "Search tool whose execute path throws.",
          parameters: Type.Object({ query: Type.String() }),
          execute: async () => {
            throw new Error("search tool crashed");
          },
        },
      ],
      runtime: scriptedRuntime("useful-brain-tool-throws", [
        searchCall("leave accrual"),
        finalText(BRAIN_NOT_ENOUGH_EVIDENCE),
      ]),
    });

    expect(result.toolCalls[0]?.status).toBe("error");
    expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
  }, 20_000);

  describe("search_knowledge budget cap", () => {
    // A cap is not a backend failure: the blocked call comes back to the model
    // as a tool error, and the model answers from the searches it already has.
    const countedRuntime = (
      provider: string,
      replies: ReturnType<typeof fauxAssistantMessage>[],
    ) => {
      const runtime = scriptedRuntime(provider, replies);
      const counter = { modelCalls: 0 };
      const stream = runtime.stream;
      return {
        counter,
        runtime: {
          ...runtime,
          stream: ((model, context, options) => {
            counter.modelCalls += 1;
            return stream!(model, context, options);
          }) as NonNullable<Parameters<typeof runKnowledgeAgent>[0]["runtime"]>["stream"],
        },
      };
    };
    const fiveSearches = [
      searchCall("leave accrual"),
      searchCall("monthly leave"),
      searchCall("leave days"),
      searchCall("leave policy"),
      searchCall("leave one more time"),
    ];

    it("answers from the first four searches when a fifth is blocked by the cap", async () => {
      const pipeline = await tinyPipeline();
      let calls = 0;
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline: {
          search: async (input) => {
            calls += 1;
            return pipeline.search(input);
          },
        },
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-grounded",
        runtime: scriptedRuntime("useful-brain-search-cap-grounded", [
          ...fiveSearches,
          finalText("Employees accrue 1.5 days of leave per month.[1]"),
        ]),
      });

      expect(calls).toBe(AGENT_BUDGETS.maxSearchKnowledge);
      expect(result.finalResponse).toBe("Employees accrue 1.5 days of leave per month.[1]");
      expect(result.aborted).toBe(false);
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.toolCalls).toHaveLength(5);
      expect(result.toolCalls.slice(0, 4).every((call) => call.status === "ok")).toBe(true);
      // The blocked call stays recorded, with the reason the model saw.
      expect(result.toolCalls[4]?.status).toBe("error");
      expect(result.toolCalls[4]?.redactedResult).toContain("search_knowledge budget exhausted");
      expect(result.toolCalls[4]?.redactedResult).toContain("no more searches run in this turn");
    }, 20_000);

    it("keeps an honest refusal when every allowed search was weak and a fifth is blocked", async () => {
      let calls = 0;
      const result = await runKnowledgeAgent({
        question: "Does the company offer a stock purchase plan?",
        pipeline: {
          search: async ({ query }) => {
            calls += 1;
            return emptySearch(query);
          },
        },
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-weak",
        runtime: scriptedRuntime("useful-brain-search-cap-weak", [
          ...fiveSearches,
          finalText(BRAIN_NOT_ENOUGH_EVIDENCE),
        ]),
      });

      expect(calls).toBe(AGENT_BUDGETS.maxSearchKnowledge);
      expect(result.finalResponse).toBe(BRAIN_NOT_ENOUGH_EVIDENCE);
      expect(result.toolCalls[4]?.status).toBe("error");
    }, 20_000);

    it("still fails closed on a real search error beside a blocked fifth search", async () => {
      const pipeline = await tinyPipeline();
      let calls = 0;
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline: {
          search: async (input) => {
            calls += 1;
            if (calls === 2) {
              throw new Error("search deadline exceeded");
            }
            return pipeline.search(input);
          },
        },
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-real-error",
        runtime: scriptedRuntime("useful-brain-search-cap-real-error", [
          ...fiveSearches,
          finalText("Employees accrue 1.5 days of leave per month.[1]"),
        ]),
      });

      expect(calls).toBe(AGENT_BUDGETS.maxSearchKnowledge);
      expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
      expect(result.refusalReason).toBeUndefined();
    }, 20_000);

    it("makes a second cap block in one run hard, so the turn is unavailable", async () => {
      const pipeline = await tinyPipeline();
      let calls = 0;
      const { counter, runtime } = countedRuntime("useful-brain-search-cap-loop", [
        ...fiveSearches,
        searchCall("leave again"),
        finalText("Employees accrue 1.5 days of leave per month.[1]"),
      ]);
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline: {
          search: async (input) => {
            calls += 1;
            return pipeline.search(input);
          },
        },
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-loop",
        runtime,
      });

      // The first block was soft and the model searched again anyway: the
      // second block ends the run before any answer is drafted.
      expect(calls).toBe(AGENT_BUDGETS.maxSearchKnowledge);
      expect(counter.modelCalls).toBe(6);
      expect(result.toolCalls).toHaveLength(6);
      expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
      expect(result.refusalReason).toBeUndefined();
    }, 20_000);

    it("answers when one message crosses the cap with several parallel searches", async () => {
      const pipeline = await tinyPipeline();
      let calls = 0;
      // Turn one issues two searches, turn two two more, turn three three:
      // searches 5 to 7 are capped together in one message.
      const parallel = (queries: string[]) =>
        fauxAssistantMessage(
          [fauxText("Searching."), ...queries.map((query) => fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query }))],
          { stopReason: "toolUse" },
        );
      const { counter, runtime } = countedRuntime("useful-brain-search-cap-parallel", [
        parallel(["a", "b"]),
        parallel(["c", "d"]),
        parallel(["e", "f", "g"]),
        finalText("Employees accrue 1.5 days of leave per month.[1]"),
      ]);
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline: {
          search: async (input) => {
            calls += 1;
            return pipeline.search(input);
          },
        },
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-parallel",
        runtime,
      });

      expect(calls).toBe(AGENT_BUDGETS.maxSearchKnowledge);
      expect(counter.modelCalls).toBe(4);
      expect(result.toolCalls.map((call) => call.status)).toEqual([
        "ok", "ok", "ok", "ok", "error", "error", "error",
      ]);
      expect(result.finalResponse).toBe("Employees accrue 1.5 days of leave per month.[1]");
      expect(result.aborted).toBe(false);
    }, 20_000);

    it("ends unavailable when a later message searches again after a parallel cap block", async () => {
      const pipeline = await tinyPipeline();
      const parallel = (queries: string[]) =>
        fauxAssistantMessage(
          [fauxText("Searching."), ...queries.map((query) => fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query }))],
          { stopReason: "toolUse" },
        );
      const { counter, runtime } = countedRuntime("useful-brain-search-cap-parallel-again", [
        parallel(["a", "b"]),
        parallel(["c", "d"]),
        parallel(["e", "f"]),
        parallel(["g"]),
        finalText("Employees accrue 1.5 days of leave per month.[1]"),
      ]);
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline,
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-parallel-again",
        runtime,
      });

      expect(counter.modelCalls).toBe(4);
      expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    }, 20_000);

    it("sends the model a plain status when the cap blocks a search", async () => {
      const pipeline = await tinyPipeline();
      const seen: string[] = [];
      const runtime = scriptedRuntime("useful-brain-search-cap-trap", [
        ...fiveSearches,
        finalText(BRAIN_NOT_ENOUGH_EVIDENCE),
      ]);
      const stream = runtime.stream!;
      const result = await runKnowledgeAgent({
        question: "What are the final pay rules for an engineer who leaves?",
        pipeline,
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-trap",
        runtime: {
          ...runtime,
          stream: ((model, context, options) => {
            const last = context.messages[context.messages.length - 1];
            if (last?.role === "toolResult") {
              seen.push(last.content.map((part) => (part.type === "text" ? part.text : "")).join(""));
            }
            return stream(model, context, options);
          }) as NonNullable<Parameters<typeof runKnowledgeAgent>[0]["runtime"]>["stream"],
        },
      });

      // The block reason is a plain status: tool results are data, so the
      // instruction lives in the system prompt, not in the result.
      const reason = seen[seen.length - 1] ?? "";
      expect(reason).toBe("search_knowledge budget exhausted: no more searches run in this turn.");
      expect(reason).not.toContain(BRAIN_NOT_ENOUGH_EVIDENCE);
      expect(LIVE_KNOWLEDGE_SYSTEM_PROMPT).toContain("budget is exhausted");
      expect(LIVE_KNOWLEDGE_SYSTEM_PROMPT).toContain("directly states the asked fact");
      expect(LIVE_KNOWLEDGE_SYSTEM_PROMPT).toContain(
        `otherwise reply exactly: ${BRAIN_NOT_ENOUGH_EVIDENCE}`,
      );
      expect(result.finalResponse).toBe(BRAIN_NOT_ENOUGH_EVIDENCE);
      expect(result.aborted).toBe(false);
    }, 20_000);

    async function identifierPipeline() {
      const store = new MemoryChunkStore();
      const embedder = new FakeEmbeddingProvider(8);
      const text = "ERR-7702 means the export queue is stalled.";
      const embeddings = await embedder.embedTexts([text]);
      store.upsert([
        {
          chunkId: "errors__body__000",
          documentId: "error-codes",
          title: "Error Codes",
          sourceName: "Error Codes",
          sourcePath: "error-codes.md",
          sectionHeading: "Export Errors",
          content: text,
          chunkIndex: 0,
          charStart: 0,
          charEnd: text.length,
          accessScope: "public" as const,
          allowedRoles: [],
          allowedDepartments: [],
          ownerUserId: "",
          embedding: embeddings[0],
        },
      ]);
      return new KnowledgePipeline({ store, embedder });
    }

    it("keeps a refusal after the cap final: the abstention recheck never runs", async () => {
      const repairGroundedAnswer = vi
        .fn()
        .mockResolvedValue("Employees accrue 1.5 days of leave per month.[1]");
      const result = await runKnowledgeAgent({
        question: "What are the final pay rules for an engineer who leaves?",
        pipeline: await tinyPipeline(),
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-refusal-final",
        runtime: {
          ...scriptedRuntime("useful-brain-search-cap-refusal-final", [
            ...fiveSearches,
            finalText(BRAIN_NOT_ENOUGH_EVIDENCE),
          ]),
          repairGroundedAnswer,
        },
      });

      expect(result.finalResponse).toBe(BRAIN_NOT_ENOUGH_EVIDENCE);
      expect(repairGroundedAnswer).not.toHaveBeenCalled();
    }, 20_000);

    it("keeps a refusal after the cap final: identifier recovery never runs", async () => {
      const repairGroundedAnswer = vi
        .fn()
        .mockResolvedValue("ERR-7702 means the export queue is stalled.[1]");
      const result = await runKnowledgeAgent({
        question: "What does error code ERR-7702 indicate?",
        pipeline: await identifierPipeline(),
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-identifier-final",
        runtime: {
          ...scriptedRuntime("useful-brain-search-cap-identifier-final", [
            ...fiveSearches,
            finalText("The evidence does not mention this error code."),
          ]),
          repairGroundedAnswer,
        },
      });

      expect(result.finalResponse).toBe(BRAIN_NOT_ENOUGH_EVIDENCE);
      expect(repairGroundedAnswer).not.toHaveBeenCalled();
    }, 20_000);

    it("ends an invalid-citation draft after a cap as a refusal, with no host repair", async () => {
      const repairGroundedAnswer = vi
        .fn()
        .mockResolvedValue("Employees accrue 1.5 days of leave per month.[1]");
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline: await tinyPipeline(),
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-invalid-draft",
        runtime: {
          ...scriptedRuntime("useful-brain-search-cap-invalid-draft", [
            ...fiveSearches,
            finalText("Employees get about a day and a half of leave each month.[1]"),
          ]),
          repairGroundedAnswer,
        },
      });

      expect(repairGroundedAnswer).not.toHaveBeenCalled();
      expect(result.finalResponse).toBe(BRAIN_NOT_ENOUGH_EVIDENCE);
      expect(result.refusalReason).toBe("model_abstained_with_evidence");
    }, 20_000);

    it.each([
      "The search budget is exhausted, so I cannot answer this question.",
      "I couldn't find final pay rules in the documents I was able to search.",
      `${"I looked through everything the search budget allowed and could not establish a rule for this. ".repeat(4)}Please ask again.`,
    ])("keeps a refusal in the model's own words final after a cap: %s", async (refusal) => {
      const repairGroundedAnswer = vi
        .fn()
        .mockResolvedValue("Employees accrue 1.5 days of leave per month.[1]");
      const result = await runKnowledgeAgent({
        question: "What are the final pay rules for an engineer who leaves?",
        pipeline: await tinyPipeline(),
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-own-words",
        runtime: {
          ...scriptedRuntime("useful-brain-search-cap-own-words", [
            ...fiveSearches,
            finalText(refusal),
          ]),
          repairGroundedAnswer,
        },
      });

      expect(repairGroundedAnswer).not.toHaveBeenCalled();
      expect(result.finalResponse).toBe(BRAIN_NOT_ENOUGH_EVIDENCE);
    }, 20_000);

    it("skips the coverage pass on a capped turn even for a validated answer", async () => {
      const coverAnswerParts = vi
        .fn()
        .mockResolvedValue("ESC-3 complaints are owned by the VP of Support. [2]");
      const result = await runKnowledgeAgent({
        question: "How do billing disputes and complaints interact?",
        pipeline: await escalationPipeline(),
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-coverage",
        runtime: {
          ...scriptedRuntime("useful-brain-search-cap-coverage", [
            ...fiveSearches,
            finalText("Billing disputes open more than 30 days move to ESC-3.[1]"),
          ]),
          coverAnswerParts,
        },
      });

      // The same draft on an uncapped turn is extended (see the multi-part
      // coverage tests); after a cap no host pass rewrites the answer.
      expect(coverAnswerParts).not.toHaveBeenCalled();
      expect(result.finalResponse).toBe("Billing disputes open more than 30 days move to ESC-3.[1]");
    }, 20_000);

    it("ends unavailable when the turn limit stops a run that had a soft cap block", async () => {
      const { tool } = echoTool();
      const echoTurn = () =>
        fauxAssistantMessage([fauxText("Echoing."), echoCall()], { stopReason: "toolUse" });
      // Searches 1 to 4, three echo turns, then search 5 in message 8: the cap
      // block is soft and the turn budget ends the loop right after it.
      const { counter, runtime } = countedRuntime("useful-brain-search-cap-turn-limit", [
        ...fiveSearches.slice(0, 4),
        echoTurn(),
        echoTurn(),
        echoTurn(),
        searchCall("e"),
        finalText("Employees accrue 1.5 days of leave per month.[1]"),
      ]);
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline: await tinyPipeline(),
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-turn-limit",
        extraTools: [tool],
        runtime,
      });

      expect(counter.modelCalls).toBe(AGENT_BUDGETS.maxTurns);
      expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
      expect(result.aborted).toBe(true);
      expect(result.errorMessage).toContain("turn budget exhausted");
    }, 20_000);

    it("counts a capped call whose result text is not the cap reason", async () => {
      // Pi can replace a tool result (for example an aborted-operation swap).
      // The exclusion needs the cap reason text, not just the id.
      const runtime = scriptedRuntime("useful-brain-search-cap-swapped", [
        ...fiveSearches,
        finalText(BRAIN_NOT_ENOUGH_EVIDENCE),
      ]);
      const stream = runtime.stream!;
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline: await tinyPipeline(),
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-swapped",
        runtime: {
          ...runtime,
          stream: ((model, context, options) => {
            const last = context.messages[context.messages.length - 1];
            if (last?.role === "toolResult" && last.content.some((part) => part.type === "text" && part.text.includes("budget exhausted"))) {
              last.content = [{ type: "text", text: "Operation aborted" }];
            }
            return stream(model, context, options);
          }) as NonNullable<Parameters<typeof runKnowledgeAgent>[0]["runtime"]>["stream"],
        },
      });

      expect(result.toolCalls[4]?.redactedResult).toContain("Operation aborted");
      expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    }, 20_000);

    it("counts a capped call whose id an ok result also carries", async () => {
      // One ok result shares the capped call's id, so the exclusion does not
      // apply and the cap result counts as a failed search. An adapter that
      // omits ids (workers-ai-chat falls back to "tool-1") gets no soft-cap
      // benefit and fails closed, by design.
      const call = (query: string, id: string) =>
        fauxAssistantMessage(
          [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query }, { id })],
          { stopReason: "toolUse" },
        );
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline: { search: async ({ query }) => emptySearch(query) },
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-ok-shared-id",
        tools: [
          {
            name: SEARCH_KNOWLEDGE_TOOL,
            label: "Search knowledge",
            description: "Search tool that always succeeds.",
            parameters: Type.Object({ query: Type.String() }),
            execute: async () => ({
              content: [{ type: "text" as const, text: "ok" }],
              details: {},
            }),
          },
        ],
        runtime: scriptedRuntime("useful-brain-search-cap-ok-shared-id", [
          call("a", "dup"),
          call("b", "b"),
          call("c", "c"),
          call("d", "d"),
          call("e", "dup"),
          finalText(BRAIN_NOT_ENOUGH_EVIDENCE),
        ]),
      });

      expect(result.toolCalls.map((entry) => entry.status)).toEqual([
        "ok", "ok", "ok", "ok", "error",
      ]);
      expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    }, 20_000);

    it("keeps a later message's cap block hard when the first cap-crossing message was mixed", async () => {
      const { executed, tool } = echoTool();
      const mixed = fauxAssistantMessage(
        [
          fauxText("Searching and echoing."),
          fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "e" }),
          fauxToolCall("plugin_echo", { query: "echo" }),
        ],
        { stopReason: "toolUse" },
      );
      const { counter, runtime } = countedRuntime("useful-brain-search-cap-mixed-first", [
        ...fiveSearches.slice(0, 4),
        mixed,
        searchCall("f"),
        finalText(BRAIN_NOT_ENOUGH_EVIDENCE),
      ]);
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline: await tinyPipeline(),
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-mixed-first",
        extraTools: [tool],
        runtime,
      });

      // The mixed message's cap block was hard but its sibling did not
      // terminate, so the model got a turn; its search in that later message
      // is a hard block and ends the run: no seventh model call.
      expect(executed).toHaveLength(1);
      expect(counter.modelCalls).toBe(6);
      expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    }, 20_000);

    it("counts a real error that shares a tool-call id with the capped call", async () => {
      // A model or adapter that reuses one id (workers-ai-chat falls back to
      // "tool-1") must not let the cap exclusion hide a real tool failure.
      let executions = 0;
      const sharedId = (query: string) =>
        fauxAssistantMessage(
          [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query }, { id: "tool-1" })],
          { stopReason: "toolUse" },
        );
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline: { search: async ({ query }) => emptySearch(query) },
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-shared-id",
        tools: [
          {
            name: SEARCH_KNOWLEDGE_TOOL,
            label: "Search knowledge",
            description: "Search tool that throws once, then succeeds.",
            parameters: Type.Object({ query: Type.String() }),
            execute: async () => {
              executions += 1;
              if (executions === 1) {
                throw new Error("search tool crashed");
              }
              return { content: [{ type: "text" as const, text: "ok" }], details: {} };
            },
          },
        ],
        runtime: scriptedRuntime("useful-brain-search-cap-shared-id", [
          sharedId("a"),
          sharedId("b"),
          sharedId("c"),
          sharedId("d"),
          sharedId("e"),
          finalText(BRAIN_NOT_ENOUGH_EVIDENCE),
        ]),
      });

      expect(executions).toBe(AGENT_BUDGETS.maxSearchKnowledge);
      expect(result.toolCalls[0]?.status).toBe("error");
      expect(result.toolCalls[4]?.status).toBe("error");
      expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    }, 20_000);

    it("keeps the search cap hard beside a pending approval in the same batch", async () => {
      const effects: string[] = [];
      const pipeline = await tinyPipeline();
      const mixed = fauxAssistantMessage(
        [
          fauxText("Searching, then filing."),
          fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "leave one more time" }),
          fauxToolCall("create_ticket", { query: "file it" }),
        ],
        { stopReason: "toolUse" },
      );
      const { counter, runtime } = countedRuntime("useful-brain-search-cap-mixed", [
        ...fiveSearches.slice(0, 4),
        mixed,
        fauxAssistantMessage(
          [fauxText("Again."), fauxToolCall("create_ticket", { query: "file it again" })],
          { stopReason: "toolUse" },
        ),
        finalText("Employees accrue 1.5 days of leave per month.[1]"),
      ]);
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month? Then file a ticket.",
        pipeline,
        principal,
        policyPrincipal,
        conversationId: "c-search-cap-mixed",
        extraTools: [
          {
            name: "create_ticket",
            label: "Create ticket",
            description: "Ticket tool whose execute path omits the policy gateway.",
            parameters: Type.Object({ query: Type.String() }),
            executionMode: "sequential",
            execute: async (_id, params: unknown) => {
              effects.push((params as { query: string }).query);
              return { content: [{ type: "text" as const, text: "filed" }], details: {} };
            },
          },
        ],
        runtime,
      });

      // The batch ended at the pending approval: no second model turn, so no
      // second proposal, and no ticket side effect.
      expect(counter.modelCalls).toBe(5);
      expect(effects).toEqual([]);
      expect(result.pendingApproval).toBe(true);
      expect(result.toolCalls.filter((call) => call.status === "pending_approval")).toHaveLength(1);
      expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    }, 20_000);

    const echoCall = () =>
      fauxToolCall("plugin_echo", { query: "echo" });
    const echoTool = () => {
      const executed: string[] = [];
      return {
        executed,
        tool: {
          name: "plugin_echo",
          label: "Echo",
          description: "Read tool for budget probes.",
          parameters: Type.Object({ query: Type.String() }),
          execute: async () => {
            executed.push("plugin_echo");
            return { content: [{ type: "text" as const, text: "ok" }], details: {} };
          },
        },
      };
    };

    it("still terminates the run when the total tool-call cap is crossed", async () => {
      const { executed, tool } = echoTool();
      // Turn one spends the whole tool-call budget. Turn two asks for a search:
      // the total cap is checked first, so it ends the run (terminate) and,
      // as a failed search call, the turn is unavailable as before.
      const { counter, runtime } = countedRuntime("useful-brain-tool-cap", [
        fauxAssistantMessage(
          [fauxText("Echoing."), ...Array.from({ length: AGENT_BUDGETS.maxToolCalls }, echoCall)],
          { stopReason: "toolUse" },
        ),
        searchCall("leave accrual"),
        finalText("Employees accrue 1.5 days of leave per month.[1]"),
      ]);
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline: await tinyPipeline(),
        principal,
        policyPrincipal,
        conversationId: "c-tool-cap",
        extraTools: [tool],
        runtime,
      });

      expect(executed).toHaveLength(AGENT_BUDGETS.maxToolCalls);
      expect(counter.modelCalls).toBe(2);
      expect(result.toolCalls).toHaveLength(AGENT_BUDGETS.maxToolCalls + 1);
      expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    }, 20_000);

    it("never runs a search past either cap when one batch crosses both", async () => {
      const pipeline = await tinyPipeline();
      let calls = 0;
      // Calls 5 to 8 hit the search cap, call 9 hits the total cap. Pi ends a
      // batch only when every call in it terminates, so the model gets one
      // more turn here; nothing past the caps executes either way.
      const burst = fauxAssistantMessage(
        [
          fauxText("Searching."),
          ...["a", "b", "c", "d", "e"].map((query) => fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query })),
        ],
        { stopReason: "toolUse" },
      );
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline: {
          search: async (input) => {
            calls += 1;
            return pipeline.search(input);
          },
        },
        principal,
        policyPrincipal,
        conversationId: "c-both-caps",
        runtime: scriptedRuntime("useful-brain-both-caps", [
          ...fiveSearches.slice(0, 4),
          burst,
          finalText("Employees accrue 1.5 days of leave per month.[1]"),
        ]),
      });

      expect(calls).toBe(AGENT_BUDGETS.maxSearchKnowledge);
      expect(result.toolCalls).toHaveLength(AGENT_BUDGETS.maxToolCalls + 1);
      expect(result.toolCalls.filter((call) => call.status === "ok")).toHaveLength(
        AGENT_BUDGETS.maxSearchKnowledge,
      );
      // The total cap blocked a search that is not a search-cap block: unavailable.
      expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    }, 20_000);
  });

  it("keeps a vector-degraded empty search an honest refusal with a recorded count", async () => {
    const result = await runKnowledgeAgent({
      question: "Does the company offer a stock purchase plan?",
      pipeline: { search: async ({ query }) => emptySearch(query, true) },
      principal,
      policyPrincipal,
      conversationId: "c-vector-degraded-empty",
      runtime: scriptedRuntime("useful-brain-degraded-empty", [
        searchCall("stock purchase plan"),
        finalText(BRAIN_NOT_ENOUGH_EVIDENCE),
      ]),
    });

    expect(result.finalResponse).toBe(BRAIN_NOT_ENOUGH_EVIDENCE);
    expect(result.vectorDegradedCount).toBe(1);
  }, 20_000);

  // Frozen clock: elapsed time is exactly `offset`, so the budget edge is
  // deterministic instead of depending on how fast the test machine runs.
  function frozenClock() {
    const base = Date.now();
    const clock = { offset: 0 };
    const spy = vi.spyOn(Date, "now").mockImplementation(() => base + clock.offset);
    return { clock, restore: () => spy.mockRestore() };
  }
  const abortError = () => new DOMException("The operation was aborted.", "AbortError");

  it("ends unavailable when an abstention recheck uses the last of the wall-time budget", async () => {
    const pipeline = await tinyPipeline();
    const { clock, restore } = frozenClock();
    try {
      // The repair deadline fires at exactly zero remaining wall time, before
      // the separate wall signal, and the catch keeps the refusal.
      const repairGroundedAnswer = vi.fn().mockImplementation(async () => {
        clock.offset = AGENT_BUDGETS.wallTimeMs;
        throw abortError();
      });
      const result = await runKnowledgeAgent({
        question: "Does the company offer a stock purchase plan?",
        pipeline,
        principal,
        policyPrincipal,
        conversationId: "c-wall-repair",
        runtime: {
          ...scriptedRuntime("useful-brain-wall-repair", [
            searchCall("stock purchase plan"),
            finalText("The retrieved documents do not contain any information about a stock purchase plan."),
          ]),
          repairGroundedAnswer,
        },
      });

      expect(repairGroundedAnswer).toHaveBeenCalledTimes(1);
      expect(result.aborted).toBe(true);
      expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    } finally {
      restore();
    }
  }, 20_000);

  it("ends unavailable when a coverage pass outlives the wall-time budget", async () => {
    const pipeline = await escalationPipeline();
    const { clock, restore } = frozenClock();
    try {
      const coverAnswerParts = vi.fn().mockImplementation(async () => {
        clock.offset = AGENT_BUDGETS.wallTimeMs + 1;
        throw abortError();
      });
      const result = await runKnowledgeAgent({
        question: "How do billing disputes and complaints interact?",
        pipeline,
        principal,
        policyPrincipal,
        conversationId: "c-wall-coverage",
        runtime: {
          ...scriptedRuntime("useful-brain-wall-coverage", [
            searchCall("billing dispute complaint"),
            finalText("Billing disputes open more than 30 days move to ESC-3.[1]"),
          ]),
          coverAnswerParts,
        },
      });

      expect(coverAnswerParts).toHaveBeenCalledTimes(1);
      expect(result.aborted).toBe(true);
      expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    } finally {
      restore();
    }
  }, 20_000);

  it("ends a run whose wall-time budget runs out mid-search as aborted and unavailable", async () => {
    const pipeline = await tinyPipeline();
    const realNow = Date.now;
    let offset = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    try {
      const result = await runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline: {
          search: async (input) => {
            // The search outlives the interactive wall-time budget.
            offset = AGENT_BUDGETS.wallTimeMs + 1_000;
            return pipeline.search(input);
          },
        },
        principal,
        policyPrincipal,
        conversationId: "c-wall-mid-search",
        runtime: scriptedRuntime("useful-brain-wall-mid-search", [
          searchCall("leave accrual"),
          finalText("Employees accrue 1.5 days of leave per month.[1]"),
        ]),
      });

      expect(result.aborted).toBe(true);
      expect(result.finalResponse).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    } finally {
      clock.mockRestore();
    }
  }, 20_000);
});
