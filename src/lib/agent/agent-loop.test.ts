import { describe, expect, it } from "vitest";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";

import { BudgetExceededError, BudgetTracker } from "./budgets";
import { argumentFingerprint, policyGateway, toolPolicy } from "./policy";
import { IdempotentExecutor, approvalFromAttempt, mutatingIdempotencyKey, resumeAfterApproval } from "./approvals";
import { createDeleteRecordsTool, createDraftTool } from "./mutating-tools";
import { FakeEmbeddingProvider } from "../retrieve/fake-embed";
import { MemoryChunkStore } from "../retrieve/memory-store";
import { KnowledgePipeline } from "../retrieve/pipeline";
import { runKnowledgeAgent, snapshotAgentMessages, toolCallsFromMessages } from "./run";
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
  it("denies high-risk tools in the first release", () => {
    expect(toolPolicy("delete_records").risk).toBe("high_risk");
    expect(
      policyGateway({
        tool: "delete_records",
        principal: policyPrincipal,
        conversationId: "c-1",
        args: { recordId: "x" },
        idempotencyKey: mutatingIdempotencyKey("delete-records", "x"),
        now: 1,
      }),
    ).toEqual({ action: "deny", reason: "high-risk actions are denied in the first release" });
  });

  it("invalidates approval when arguments change", () => {
    const approval = approvalFromAttempt({
      principalId: policyPrincipal.id,
      conversationId: "c-1",
      tool: "create_draft",
      args: { title: "alpha" },
      idempotencyKey: mutatingIdempotencyKey("create-draft", "alpha"),
      expiresAt: 10_000,
    });
    const denied = policyGateway({
      tool: "create_draft",
      principal: policyPrincipal,
      conversationId: "c-1",
      args: { title: "beta" },
      idempotencyKey: mutatingIdempotencyKey("create-draft", "alpha"),
      now: 1,
      approval,
    });
    expect(denied.action).toBe("deny");
    expect(argumentFingerprint({ title: "alpha" })).not.toBe(argumentFingerprint({ title: "beta" }));
  });

  it("does not repeat a mutating side effect on duplicate delivery", async () => {
    const executor = new IdempotentExecutor();
    const drafts: string[] = [];
    const approval = approvalFromAttempt({
      principalId: policyPrincipal.id,
      conversationId: "c-1",
      tool: "create_draft",
      args: { title: "alpha" },
      idempotencyKey: mutatingIdempotencyKey("create-draft", "alpha"),
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
    await tool.execute("t2", { title: "alpha" });
    expect(drafts).toEqual(["alpha"]);
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
    expect(() => {
      for (let i = 0; i < 9; i += 1) {
        budgets.noteTurn();
      }
    }).toThrow(BudgetExceededError);
  });
});

describe("Pi knowledge agent", () => {
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
    const executor = new IdempotentExecutor();
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
    const executor = new IdempotentExecutor();
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
});
