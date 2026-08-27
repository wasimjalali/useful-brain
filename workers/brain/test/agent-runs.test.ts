import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { addCitationLabels, PROMPT_VERSION } from "../../../src/lib/answer/contract";
import { argumentFingerprint } from "../../../src/lib/agent/policy";
import {
  completeTurn,
  createPendingTurn,
} from "../../../src/lib/store/conversations";
import {
  completeAgentRun,
  createAgentRun,
  loadAgentReplay,
  upsertApproval,
} from "../../../src/lib/store/agent-runs";
import { seedPrincipals } from "./seed";

describe("agent run replay records", () => {
  it("stores model, prompt version, corpus generation, evidence, tools and approval", async () => {
    await seedPrincipals();
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-agent-1",
      question: "how much leave per month",
      now: 40,
    });
    const evidence = addCitationLabels([
      {
        rank: 1,
        score: 0.9,
        chunkId: "leave-policy__body__000",
        source: "leave-policy.md",
        section: "Leave",
        text: "Employees accrue 1.5 days of leave per month.",
        tokenEstimate: 12,
      },
    ]);
    const completed = await completeTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      assistantMessageId: pending.assistantMessageId,
      requestId: "req-agent-1",
      rawModelJson: JSON.stringify({
        answerType: "grounded",
        paragraphs: [{ text: "Leave accrues monthly.", citations: ["[1]"] }],
      }),
      evidence,
      answerModel: "phase5-faux",
      embeddingModel: "fake-embed",
      embeddingDimensions: 8,
      promptVersion: PROMPT_VERSION,
      retrievalConfigVersion: "fake-provider",
      corpusGenerationId: "gen-1",
      now: 41,
    });
    const created = await createAgentRun(env.OPERATIONS_DB, {
      runId: "run-agent-1",
      conversationId: pending.conversationId,
      principalId: "principal-alice",
      model: "phase5-faux",
      promptVersion: PROMPT_VERSION,
      corpusGenerationId: "gen-1",
      evidenceMessageId: completed.assistantMessageId,
      now: 42,
    });
    await completeAgentRun(env.OPERATIONS_DB, {
      runId: created.runId,
      status: "pending_approval",
      toolCalls: [
        {
          tool: "search_knowledge",
          argumentFingerprint: argumentFingerprint({ query: "how much leave per month" }),
          redactedResult: "{\"hits\":1}",
          status: "ok",
        },
        {
          tool: "create_draft",
          argumentFingerprint: argumentFingerprint({ title: "alpha" }),
          redactedResult: "pending_approval",
          status: "pending_approval",
        },
      ],
      now: 43,
    });
    await upsertApproval(
      env.OPERATIONS_DB,
      {
        principalId: "principal-alice",
        conversationId: pending.conversationId,
        tool: "create_draft",
        argumentFingerprint: argumentFingerprint({ title: "alpha" }),
        idempotencyKey: "draft-alpha",
        expiresAt: 99_000,
      },
      "pending",
      44,
    );
    const replayed = await loadAgentReplay(env.OPERATIONS_DB, "run-agent-1");
    expect(replayed?.model).toBe("phase5-faux");
    expect(replayed?.promptVersion).toBe(PROMPT_VERSION);
    expect(replayed?.corpusGenerationId).toBe("gen-1");
    expect(replayed?.evidenceMessageId).toBe(completed.assistantMessageId);
    expect(replayed?.status).toBe("pending_approval");
    expect(replayed?.toolCalls.map((call) => call.tool)).toEqual(["search_knowledge", "create_draft"]);
    expect(replayed?.approval?.idempotencyKey).toBe("draft-alpha");
    const again = await createAgentRun(env.OPERATIONS_DB, {
      runId: "run-agent-1",
      conversationId: pending.conversationId,
      principalId: "principal-alice",
      model: "phase5-faux",
      promptVersion: PROMPT_VERSION,
      corpusGenerationId: "gen-1",
      now: 50,
    });
    expect(again.runId).toBe("run-agent-1");
  });
});
