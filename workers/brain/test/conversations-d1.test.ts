import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { addCitationLabels, PROMPT_VERSION } from "../../../src/lib/answer/contract";
import { executeTurn } from "../../../src/lib/brain/execute-turn";
import { WorkerCancelledError } from "../../../src/lib/cf/worker-errors";
import { loadConversationForUi } from "../../../src/lib/store/conversation-queries";
import {
  completeTurn,
  createPendingTurn,
  failTurn,
  loadBoundedHistory,
  loadOwnedTurnHandleByRequestId,
  loadReplay,
  persistThenRelease,
} from "../../../src/lib/store/conversations";
import { seedPrincipals } from "./seed";

describe("operations conversation snapshots", () => {
  it("fails a cancelled run without persisting a model answer", async () => {
    await seedPrincipals();
    let cancelled = false;
    let released = false;
    const turn = executeTurn({
      operations: env.OPERATIONS_DB,
      principal: {
        id: "principal-alice",
        subject: "alice@karkoai.com",
        kind: "user",
        roles: ["operator"],
        departments: ["engineering"],
      },
      question: "Stop this answer",
      requestId: "req-cancel-execution",
      lockFor: () => ({
        acquire: async (runId) => ({ ok: true, runId }),
        cancelled: async () => cancelled,
        release: async () => {
          released = true;
          return { ok: true };
        },
      }),
      ai: {
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 350));
          return {
            choices: [
              {
                finish_reason: "stop",
                message: { content: "This answer must not be stored." },
              },
            ],
          };
        },
      },
    });
    const rejected = expect(turn).rejects.toBeInstanceOf(WorkerCancelledError);
    await new Promise((resolve) => setTimeout(resolve, 30));
    cancelled = true;
    await rejected;

    expect(released).toBe(true);
    const stored = await env.OPERATIONS_DB.prepare(
      `SELECT conversation_id, status, error_code, content
       FROM messages WHERE request_id = ? AND role = 'assistant'`,
    )
      .bind("req-cancel-execution")
      .first<{
        conversation_id: string;
        status: string;
        error_code: string;
        content: string;
      }>();
    expect(stored).toMatchObject({ status: "failed", error_code: "CANCELLED", content: "" });
    if (!stored) {
      throw new Error("cancelled assistant message was not stored");
    }
    const conversation = await loadConversationForUi(
      env.OPERATIONS_DB,
      stored.conversation_id,
      "principal-alice",
    );
    expect(conversation.turns[0]).toMatchObject({ cancelled: true, error: null });
  });

  it("resolves a pending run only for its conversation owner", async () => {
    await seedPrincipals();
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-cancel-handle",
      question: "Stop this answer",
      now: 5,
    });
    await expect(
      loadOwnedTurnHandleByRequestId(
        env.OPERATIONS_DB,
        "req-cancel-handle",
        "principal-alice",
      ),
    ).resolves.toEqual({
      conversationId: pending.conversationId,
      runId: pending.assistantMessageId,
      status: "pending",
    });
    await expect(
      loadOwnedTurnHandleByRequestId(
        env.OPERATIONS_DB,
        "req-cancel-handle",
        "principal-bot",
      ),
    ).resolves.toBeNull();
  });

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
        vectorScore: 0.84,
        keywordScore: 0.73,
        fusedScore: 0.81,
        rerankScore: 0.91,
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
    expect(replayed?.retrieval.results[0]).toMatchObject({
      vectorScore: 0.84,
      keywordScore: 0.73,
      fusedScore: 0.81,
      rerankScore: 0.91,
    });
    const conversation = await loadConversationForUi(
      env.OPERATIONS_DB,
      pending.conversationId,
      "principal-alice",
    );
    expect(conversation.turns[0]?.answer?.retrieval.results[0]).toMatchObject({
      vectorScore: 0.84,
      keywordScore: 0.73,
      fusedScore: 0.81,
      rerankScore: 0.91,
    });
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

  it("rejects a reused request id when the question does not match the claim", async () => {
    await seedPrincipals();
    const first = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-mismatch-1",
      question: "What is the refund window?",
      now: 85,
    });
    await expect(
      createPendingTurn(env.OPERATIONS_DB, {
        ownerPrincipalId: "principal-alice",
        requestId: "req-mismatch-1",
        question: "What is the discount policy?",
        now: 86,
      }),
    ).rejects.toThrow(/request payload does not match the claimed request id/);
    const users = await env.OPERATIONS_DB.prepare(
      `SELECT content FROM messages WHERE conversation_id = ? AND role = 'user'`,
    )
      .bind(first.conversationId)
      .first<{ content: string }>();
    expect(users?.content).toBe("What is the refund window?");
  });

  it("rejects a reused request id when the claim digest is missing and the question differs", async () => {
    await seedPrincipals();
    const first = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-null-digest-1",
      question: "What is the refund window?",
      now: 87,
    });
    await env.OPERATIONS_DB.prepare(
      `UPDATE request_id_claims SET payload_digest = NULL WHERE request_id = ?`,
    )
      .bind("req-null-digest-1")
      .run();
    await expect(
      createPendingTurn(env.OPERATIONS_DB, {
        ownerPrincipalId: "principal-alice",
        requestId: "req-null-digest-1",
        question: "What is the discount policy?",
        now: 88,
      }),
    ).rejects.toThrow(/request payload does not match the claimed request id/);
    const replay = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-null-digest-1",
      question: "What is the refund window?",
      now: 89,
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.conversationId).toBe(first.conversationId);
  });

  it("rejects a reused request id when no claim exists and the stored question differs", async () => {
    await seedPrincipals();
    const first = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-orphan-msg-1",
      question: "What is the refund window?",
      now: 90,
    });
    await env.OPERATIONS_DB.prepare(`DELETE FROM request_id_claims WHERE request_id = ?`)
      .bind("req-orphan-msg-1")
      .run();
    await expect(
      createPendingTurn(env.OPERATIONS_DB, {
        ownerPrincipalId: "principal-alice",
        requestId: "req-orphan-msg-1",
        question: "What is the discount policy?",
        now: 91,
      }),
    ).rejects.toThrow(/request payload does not match the claimed request id/);
    const replay = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-orphan-msg-1",
      question: "What is the refund window?",
      now: 92,
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.conversationId).toBe(first.conversationId);
  });

  it("replays and bounds history by parent user message when timestamps collide", async () => {
    await seedPrincipals();
    const seed = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-hist-seed",
      question: "seed question",
      now: 90,
    });
    const complete = (
      pending: { assistantMessageId: string },
      requestId: string,
      text: string,
      now: number,
    ) =>
      completeTurn(env.OPERATIONS_DB, {
        ownerPrincipalId: "principal-alice",
        assistantMessageId: pending.assistantMessageId,
        requestId,
        rawModelJson: JSON.stringify({
          answerType: "grounded",
          paragraphs: [{ text, citations: ["[1]"] }],
        }),
        evidence: addCitationLabels([
          {
            rank: 1,
            score: 0.9,
            chunkId: `chunk-${requestId}`,
            source: `${requestId}.md`,
            section: "Body",
            text,
            tokenEstimate: 4,
          },
        ]),
        answerModel: "test-model",
        embeddingModel: "fake-embed",
        embeddingDimensions: 8,
        promptVersion: PROMPT_VERSION,
        retrievalConfigVersion: "fake-provider",
        corpusGenerationId: "gen-1",
        now,
      });
    await complete(seed, "req-hist-seed", "Seed answer is stored first.", 91);
    const [one, two] = await Promise.all([
      createPendingTurn(env.OPERATIONS_DB, {
        ownerPrincipalId: "principal-alice",
        conversationId: seed.conversationId,
        requestId: "req-hist-a",
        question: "question one",
        now: 100,
      }),
      createPendingTurn(env.OPERATIONS_DB, {
        ownerPrincipalId: "principal-alice",
        conversationId: seed.conversationId,
        requestId: "req-hist-b",
        question: "question two",
        now: 100,
      }),
    ]);
    await complete(one, "req-hist-a", "Answer from turn one.", 110);
    await complete(two, "req-hist-b", "Answer from turn two.", 111);
    const replayOne = await loadReplay(env.OPERATIONS_DB, one.assistantMessageId, "principal-alice");
    const replayTwo = await loadReplay(env.OPERATIONS_DB, two.assistantMessageId, "principal-alice");
    expect(replayOne?.question).toBe("question one");
    expect(replayOne?.answer).toContain("Answer from turn one.");
    expect(replayTwo?.question).toBe("question two");
    expect(replayTwo?.answer).toContain("Answer from turn two.");
    const history = await loadBoundedHistory(
      env.OPERATIONS_DB,
      seed.conversationId,
      "principal-alice",
    );
    expect(history.find((turn) => turn.question === "question one")?.answer).toContain("Answer from turn one.");
    expect(history.find((turn) => turn.question === "question two")?.answer).toContain("Answer from turn two.");
    expect(history.find((turn) => turn.question === "question two")?.answer).not.toContain("Answer from turn one.");
  });

  it("includes pre-migration completed turns that have no parent user message", async () => {
    await seedPrincipals();
    const seed = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      requestId: "req-hist-parented",
      question: "parented question",
      now: 120,
    });
    await completeTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-alice",
      assistantMessageId: seed.assistantMessageId,
      requestId: "req-hist-parented",
      rawModelJson: JSON.stringify({
        answerType: "grounded",
        paragraphs: [{ text: "Parented answer is stored.", citations: ["[1]"] }],
      }),
      evidence: addCitationLabels([
        {
          rank: 1,
          score: 0.9,
          chunkId: "chunk-parented",
          source: "parented.md",
          section: "Body",
          text: "Parented answer is stored.",
          tokenEstimate: 4,
        },
      ]),
      answerModel: "test-model",
      embeddingModel: "fake-embed",
      embeddingDimensions: 8,
      promptVersion: PROMPT_VERSION,
      retrievalConfigVersion: "fake-provider",
      corpusGenerationId: "gen-1",
      now: 121,
    });
    await env.OPERATIONS_DB.batch([
      env.OPERATIONS_DB.prepare(
        `INSERT INTO messages (
           id, conversation_id, request_id, parent_user_message_id, role, content, status, created_at, updated_at
         ) VALUES (?, ?, NULL, NULL, 'user', ?, 'completed', ?, ?)`,
      ).bind("msg-legacy-user", seed.conversationId, "legacy question", 130, 130),
      env.OPERATIONS_DB.prepare(
        `INSERT INTO messages (
           id, conversation_id, request_id, parent_user_message_id, role, content, status,
           answer_type, created_at, updated_at
         ) VALUES (?, ?, NULL, NULL, 'assistant', ?, 'completed', 'grounded', ?, ?)`,
      ).bind(
        "msg-legacy-assistant",
        seed.conversationId,
        "Legacy answer is stored without a parent.",
        131,
        131,
      ),
    ]);
    const history = await loadBoundedHistory(
      env.OPERATIONS_DB,
      seed.conversationId,
      "principal-alice",
    );
    expect(history.find((turn) => turn.question === "parented question")?.answer).toContain(
      "Parented answer is stored.",
    );
    expect(history.find((turn) => turn.question === "legacy question")?.answer).toBe(
      "Legacy answer is stored without a parent.",
    );
  });
});
