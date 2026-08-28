import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { addCitationLabels, PROMPT_VERSION } from "../../../src/lib/answer/contract";
import { argumentFingerprint } from "../../../src/lib/agent/policy";
import { D1IdempotencyStore, IdempotentExecutor } from "../../../src/lib/agent/approvals";
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
          normalizedArguments: { query: "how much leave per month" },
          redactedResult: "{\"hits\":1}",
          status: "ok",
        },
        {
          tool: "create_draft",
          argumentFingerprint: argumentFingerprint({ title: "alpha" }),
          normalizedArguments: { title: "alpha" },
          redactedResult: "pending_approval",
          status: "pending_approval",
        },
      ],
      now: 43,
    });
    await upsertApproval(
      env.OPERATIONS_DB,
      created.runId,
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

  it("rejects reuse of an approval key with a different binding", async () => {
    await seedPrincipals();
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-binding",
      question: "Create alpha",
      now: 95,
    });
    await createAgentRun(env.OPERATIONS_DB, {
      runId: "run-binding",
      conversationId: pending.conversationId,
      principalId: "principal-alice",
      model: "phase5-faux",
      promptVersion: PROMPT_VERSION,
      corpusGenerationId: "gen-1",
      now: 96,
    });
    await completeAgentRun(env.OPERATIONS_DB, {
      runId: "run-binding",
      status: "pending_approval",
      toolCalls: [{
        tool: "create_draft",
        argumentFingerprint: argumentFingerprint({ title: "alpha" }),
        normalizedArguments: { title: "alpha" },
        redactedResult: "pending_approval",
        status: "pending_approval",
      }],
      now: 97,
    });
    const binding = {
      principalId: "principal-alice",
      conversationId: pending.conversationId,
      tool: "create_draft",
      argumentFingerprint: argumentFingerprint({ title: "alpha" }),
      idempotencyKey: "draft-binding",
      expiresAt: 99_000,
    };
    await upsertApproval(env.OPERATIONS_DB, "run-binding", binding, "pending", 100);
    await expect(
      upsertApproval(
        env.OPERATIONS_DB,
        "run-binding",
        { ...binding, principalId: "principal-bot", tool: "send_email" },
        "approved",
        101,
      ),
    ).rejects.toThrow(/binding/);
  });

  it("records tool calls once when completion is delivered concurrently", async () => {
    await seedPrincipals();
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-run-concurrent",
      question: "Concurrent",
      now: 110,
    });
    await createAgentRun(env.OPERATIONS_DB, {
      runId: "run-concurrent",
      conversationId: pending.conversationId,
      principalId: "principal-alice",
      model: "phase5-faux",
      promptVersion: PROMPT_VERSION,
      corpusGenerationId: "gen-1",
      now: 111,
    });
    const completion = {
      runId: "run-concurrent",
      status: "completed" as const,
      toolCalls: [{
        tool: "search_knowledge",
        argumentFingerprint: argumentFingerprint({ query: "Concurrent" }),
        normalizedArguments: { query: "Concurrent" },
        redactedResult: "{}",
        status: "ok" as const,
      }],
      now: 112,
    };
    await Promise.all([
      completeAgentRun(env.OPERATIONS_DB, completion),
      completeAgentRun(env.OPERATIONS_DB, completion),
    ]);
    const rows = await env.OPERATIONS_DB.prepare(
      "SELECT COUNT(*) AS count FROM tool_calls WHERE run_id = ?",
    ).bind("run-concurrent").first<{ count: number }>();
    expect(rows?.count).toBe(1);
  });

  it("deduplicates a completed side effect across executor instances", async () => {
    let effects = 0;
    const first = new IdempotentExecutor(new D1IdempotencyStore(env.OPERATIONS_DB));
    const second = new IdempotentExecutor(new D1IdempotencyStore(env.OPERATIONS_DB));
    expect(
      await first.run("sink-durable-effect", () => {
        effects += 1;
        return { ok: true };
      }),
    ).toEqual({ ok: true });
    expect(
      await second.run("sink-durable-effect", () => {
        effects += 1;
        return { ok: false };
      }),
    ).toEqual({ ok: true });
    expect(effects).toBe(1);
  });
});
