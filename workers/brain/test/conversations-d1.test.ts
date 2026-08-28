import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { addCitationLabels, PROMPT_VERSION } from "../../../src/lib/answer/contract";
import {
  completeTurn,
  createPendingTurn,
  failTurn,
  loadReplay,
  persistThenRelease,
} from "../../../src/lib/store/conversations";
import { seedPrincipals } from "./seed";

describe("operations conversation snapshots", () => {
  it("replays a completed turn from the stored evidence snapshot", async () => {
    await seedPrincipals();
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-replay-1",
      question: "Can a customer return an opened product?",
      now: 10,
    });
    expect(pending.duplicate).toBe(false);
    const evidence = addCitationLabels([
      {
        rank: 1,
        score: 0.91,
        chunkId: "return_policy__chunk_002",
        source: "return_policy.md",
        section: "Standard Return Window",
        text: "Opened products may be returned within 30 days.",
        tokenEstimate: 12,
        documentId: "return_policy",
      },
    ]);
    const completed = await completeTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      assistantMessageId: pending.assistantMessageId,
      requestId: "req-replay-1",
      rawModelJson: JSON.stringify({
        answerType: "grounded",
        paragraphs: [{ text: "Opened products may be returned within 30 days.", citations: ["[1]"] }],
      }),
      evidence,
      answerModel: "test-model",
      embeddingModel: "fake-embed",
      embeddingDimensions: 8,
      promptVersion: PROMPT_VERSION,
      retrievalConfigVersion: "fake-provider",
      corpusGenerationId: "gen-1",
      now: 11,
    });
    const replayed = await loadReplay(
      env.OPERATIONS_DB,
      pending.assistantMessageId,
      "principal-alice",
    );
    expect(replayed).toEqual(completed);
    expect(replayed?.answer).toContain("Opened products may be returned within 30 days. [1]");
    expect(replayed?.retrieval.results).toEqual(evidence);
    expect(replayed?.retrieval.results[0]?.documentId).toBe("return_policy");
    expect(replayed?.retrieval.results[0]?.chunkId).toBe("return_policy__chunk_002");
    expect(replayed?.retrieval.results[0]?.text).toContain("Opened products may be returned");
    expect(replayed?.retrieval.results[0]?.citationLabel).toBe("[1]");
    expect(replayed?.corpusGenerationId).toBe("gen-1");
    expect(replayed?.structuredAnswer.answerType).toBe("grounded");
    expect(replayed?.promptVersion).toBe(PROMPT_VERSION);
  });

  it("refuses invalid citation IDs and is idempotent on request id", async () => {
    await seedPrincipals();
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-invalid-1",
      question: "What is the 401(k) match?",
      now: 20,
    });
    const evidence = addCitationLabels([
      {
        rank: 1,
        score: 0.2,
        chunkId: "unrelated__chunk_001",
        source: "handbook.md",
        section: "Office",
        text: "The Austin office opens at nine.",
        tokenEstimate: 8,
      },
    ]);
    const first = await completeTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      assistantMessageId: pending.assistantMessageId,
      requestId: "req-invalid-1",
      rawModelJson: JSON.stringify({
        answerType: "grounded",
        paragraphs: [{ text: "The match is 6 percent.", citations: ["[9]"] }],
      }),
      evidence,
      answerModel: "test-model",
      embeddingModel: "fake-embed",
      embeddingDimensions: 8,
      promptVersion: PROMPT_VERSION,
      retrievalConfigVersion: "fake-provider",
      corpusGenerationId: "gen-1",
      now: 21,
    });
    expect(first.structuredAnswer.answerType).toBe("insufficient_evidence");
    expect(first.structuredAnswer.paragraphs[0].citations).toEqual([]);
    const duplicatePending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-invalid-1",
      question: "What is the 401(k) match?",
      now: 22,
    });
    expect(duplicatePending.duplicate).toBe(true);
    expect(duplicatePending.assistantMessageId).toBe(pending.assistantMessageId);
    const second = await completeTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      assistantMessageId: pending.assistantMessageId,
      requestId: "req-invalid-1",
      rawModelJson: JSON.stringify({
        answerType: "grounded",
        paragraphs: [{ text: "changed", citations: ["[1]"] }],
      }),
      evidence,
      answerModel: "other-model",
      embeddingModel: "fake-embed",
      embeddingDimensions: 8,
      promptVersion: PROMPT_VERSION,
      retrievalConfigVersion: "fake-provider",
      corpusGenerationId: "gen-1",
      now: 23,
    });
    expect(second.answer).toBe(first.answer);
    expect(second.structuredAnswer.answerType).toBe("insufficient_evidence");
  });

  it("persists the snapshot before the run lock is released", async () => {
    await seedPrincipals();
    const stub = env.CONVERSATION.getByName("conv-persist-release");
    expect(await stub.acquire("run-persist")).toEqual({ ok: true, runId: "run-persist" });
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-lock-1",
      question: "Leave policy?",
      now: 30,
    });
    await persistThenRelease({
      persist: () =>
        completeTurn(env.OPERATIONS_DB, {
          ownerPrincipalId: "principal-alice",
          assistantMessageId: pending.assistantMessageId,
          requestId: "req-lock-1",
          rawModelJson: JSON.stringify({
            answerType: "grounded",
            paragraphs: [{ text: "Leave accrues monthly.", citations: ["[1]"] }],
          }),
          evidence: addCitationLabels([
            {
              rank: 1,
              score: 0.8,
              chunkId: "leave__chunk_001",
              source: "leave.md",
              section: "Accrual",
              text: "Leave accrues monthly.",
              tokenEstimate: 4,
            },
          ]),
          answerModel: "test-model",
          embeddingModel: "fake-embed",
          embeddingDimensions: 8,
          promptVersion: PROMPT_VERSION,
          retrievalConfigVersion: "fake-provider",
          corpusGenerationId: "gen-1",
          now: 31,
        }),
      release: () => stub.release("run-persist"),
    });
    expect(await stub.status()).toEqual({ runId: null });
    const replayed = await loadReplay(
      env.OPERATIONS_DB,
      pending.assistantMessageId,
      "principal-alice",
    );
    expect(replayed?.structuredAnswer.answerType).toBe("grounded");
  });

  it("does not let another principal fail a pending turn", async () => {
    await seedPrincipals();
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-owned-failure",
      question: "Private question",
      now: 60,
    });
    await expect(
      failTurn(env.OPERATIONS_DB, {
        assistantMessageId: pending.assistantMessageId,
        ownerPrincipalId: "principal-bot",
        errorCode: "CANCELLED",
        now: 61,
      }),
    ).rejects.toThrow(/FORBIDDEN/);
    const row = await env.OPERATIONS_DB.prepare("SELECT status FROM messages WHERE id = ?")
      .bind(pending.assistantMessageId)
      .first<{ status: string }>();
    expect(row?.status).toBe("pending");
  });

  it("keeps the completed answer and evidence snapshot from the same writer", async () => {
    await seedPrincipals();
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-snapshot-race",
      question: "Race",
      now: 70,
    });
    const complete = (label: string, now: number) => completeTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      assistantMessageId: pending.assistantMessageId,
      requestId: "req-snapshot-race",
      rawModelJson: JSON.stringify({
        answerType: "grounded",
        paragraphs: [{ text: `Answer from ${label}.`, citations: ["[1]"] }],
      }),
      evidence: addCitationLabels([{
        rank: 1,
        score: 0.9,
        chunkId: `chunk-${label}`,
        source: `${label}.md`,
        section: label,
        text: `Answer from ${label}.`,
        tokenEstimate: 3,
      }]),
      answerModel: "test-model",
      embeddingModel: "fake-embed",
      embeddingDimensions: 8,
      promptVersion: PROMPT_VERSION,
      retrievalConfigVersion: "fake-provider",
      corpusGenerationId: "gen-1",
      now,
    });
    const attempts = await Promise.allSettled([complete("alpha", 71), complete("beta", 72)]);
    expect(attempts.some((attempt) => attempt.status === "fulfilled")).toBe(true);
    for (const attempt of attempts) {
      if (attempt.status === "rejected") {
        expect(String(attempt.reason)).toMatch(/owned by another writer/);
      }
    }
    const replayed = await loadReplay(
      env.OPERATIONS_DB,
      pending.assistantMessageId,
      "principal-alice",
    );
    const label = replayed?.answer.includes("alpha") ? "alpha" : "beta";
    expect(replayed?.retrieval.results[0]?.chunkId).toBe(`chunk-${label}`);
  });

  it("collapses concurrent first turns with the same request id onto one conversation", async () => {
    await seedPrincipals();
    const attempts = await Promise.all([
      createPendingTurn(env.OPERATIONS_DB, {
        ownerPrincipalId: "principal-alice",
        requestId: "req-concurrent-1",
        question: "What is the refund window?",
        now: 80,
      }),
      createPendingTurn(env.OPERATIONS_DB, {
        ownerPrincipalId: "principal-alice",
        requestId: "req-concurrent-1",
        question: "What is the refund window?",
        now: 81,
      }),
    ]);
    expect(attempts[0].conversationId).toBe(attempts[1].conversationId);
    expect(attempts[0].assistantMessageId).toBe(attempts[1].assistantMessageId);
    expect(attempts.some((attempt) => attempt.duplicate)).toBe(true);
    const byRequest = await env.OPERATIONS_DB.prepare(
      "SELECT COUNT(*) AS count FROM messages WHERE request_id = ?",
    )
      .bind("req-concurrent-1")
      .first<{ count: number }>();
    const users = await env.OPERATIONS_DB.prepare(
      `SELECT COUNT(*) AS count FROM messages
       WHERE conversation_id = ? AND role = 'user'`,
    )
      .bind(attempts[0].conversationId)
      .first<{ count: number }>();
    const assistants = await env.OPERATIONS_DB.prepare(
      `SELECT COUNT(*) AS count FROM messages
       WHERE conversation_id = ? AND role = 'assistant'`,
    )
      .bind(attempts[0].conversationId)
      .first<{ count: number }>();
    const orphans = await env.OPERATIONS_DB.prepare(
      `SELECT COUNT(*) AS count FROM conversations c
       WHERE c.owner_principal_id = ?
         AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)`,
    )
      .bind("principal-alice")
      .first<{ count: number }>();
    expect(byRequest?.count).toBe(1);
    expect(users?.count).toBe(1);
    expect(assistants?.count).toBe(1);
    expect(orphans?.count).toBe(0);
  });
});
