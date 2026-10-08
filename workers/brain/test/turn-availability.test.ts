import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { AGENT_BUDGETS } from "../../../src/lib/agent/budgets";
import { BRAIN_KNOWLEDGE_UNAVAILABLE, BRAIN_NOT_ENOUGH_EVIDENCE } from "../../../src/lib/agent/host-grounding";
import { executeTurn } from "../../../src/lib/brain/execute-turn";
import {
  WorkerUnavailableError,
  workerErrorResponse,
} from "../../../src/lib/cf/worker-errors";
import type { CorpusSql, VectorizeIndex } from "../../../src/lib/retrieve/cloudflare-pipeline";
import { seedPrincipals } from "./seed";

// Backend failures during retrieval must never come back as an honest
// "not enough evidence" refusal: the brownout run on 2026-10-08 scored 15
// stalled turns as model failures because they did.

const principal = {
  id: "principal-alice",
  subject: "alice@karkoai.com",
  kind: "user" as const,
  roles: ["operator"],
  departments: ["engineering"],
};

const chunkRow = {
  chunk_id: "refund__001",
  document_id: "refund",
  heading: "Refund window",
  content: "Annual plans have a fourteen day refund window.",
  chunk_index: 0,
  start_offset: 0,
  end_offset: 48,
  access_scope: "public",
  allowed_roles: "[]",
  allowed_departments: "[]",
  metadata: "{}",
  path: "refund.md",
};

function corpusDatabase(options: { ftsFails?: boolean } = {}): CorpusSql {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async all<T>() {
              let rows: unknown[];
              if (sql.includes("SELECT DISTINCT access_scope")) {
                rows = [
                  {
                    access_scope: "public",
                    allowed_roles: "[]",
                    allowed_departments: "[]",
                    metadata: "{}",
                  },
                ];
              } else if (sql.includes("chunks_fts MATCH")) {
                if (options.ftsFails) {
                  throw new Error("D1_ERROR: Network connection lost.");
                }
                rows = [{ chunk_id: chunkRow.chunk_id }];
              } else if (sql.includes("SELECT vector_id, chunk_id")) {
                rows = [{ vector_id: "vector-1", chunk_id: chunkRow.chunk_id }];
              } else if (sql.includes("FROM chunks c")) {
                rows = [chunkRow];
              } else {
                rows = [];
              }
              return { results: rows as T[] };
            },
            async first<T>() {
              return null as T | null;
            },
          };
        },
        async first<T>() {
          if (sql.includes("corpus_state")) {
            return { active_generation_id: "g-1" } as T;
          }
          return null as T | null;
        },
      };
    },
  };
}

const workingVectorize: VectorizeIndex = {
  query: async () => ({ matches: [{ id: "vector-1", score: 0.8 }] }),
};

const failingVectorize: VectorizeIndex = {
  query: async () => {
    throw new Error("vectorize internal error; reference = abc123");
  },
};

/**
 * Workers AI stub: the first chat call asks for one search, the second
 * replies with `finalReply`. Embedding and rerank calls succeed unless told
 * to fail.
 */
function aiStub(options: {
  finalReply: string;
  embeddingFails?: boolean;
  rerankFails?: boolean;
  onRerank?: () => void;
}) {
  let chatCalls = 0;
  return vi.fn().mockImplementation(async (_model: string, input: Record<string, unknown>) => {
    if ("tools" in input) {
      chatCalls += 1;
      if (chatCalls === 1) {
        return {
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "search_knowledge",
                      arguments: JSON.stringify({ query: "refund window" }),
                    },
                  },
                ],
              },
            },
          ],
        };
      }
      return { choices: [{ finish_reason: "stop", message: { content: options.finalReply } }] };
    }
    if ("queries" in input) {
      if (options.embeddingFails) {
        throw new Error("internal error; reference = vvq7gr6iva7kmnjkv45q2svp");
      }
      return { data: [Array.from({ length: 1024 }, () => 0.1)] };
    }
    if ("contexts" in input) {
      options.onRerank?.();
      if (options.rerankFails) {
        throw new Error("internal error; reference = 6h7skgod0dt04a0cdq6holq4");
      }
      return { response: [{ id: 0, score: 0.95 }] };
    }
    // Repair and coverage passes return nothing useful.
    return { choices: [{ finish_reason: "stop", message: { content: "null" } }] };
  });
}

function lockStub() {
  return () => ({
    acquire: async (runId: string) => ({ ok: true as const, runId }),
    cancelled: async () => false,
    release: async () => ({ ok: true as const }),
  });
}

function ephemeralTurn(input: {
  requestId: string;
  run: ReturnType<typeof aiStub>;
  corpus?: CorpusSql;
  vectorize?: VectorizeIndex;
}) {
  return executeTurn({
    operations: env.OPERATIONS_DB,
    corpus: input.corpus ?? corpusDatabase(),
    vectorize: input.vectorize,
    principal,
    question: "What is the refund window?",
    requestId: input.requestId,
    lockFor: lockStub(),
    ai: { run: input.run },
    persistConversation: false,
  });
}

describe("retrieval backend failures on a turn", () => {
  it("returns the availability error, not a refusal, when D1 FTS fails", async () => {
    await seedPrincipals();
    await expect(
      ephemeralTurn({
        requestId: "req-avail-fts",
        corpus: corpusDatabase({ ftsFails: true }),
        vectorize: workingVectorize,
        run: aiStub({ finalReply: BRAIN_NOT_ENOUGH_EVIDENCE }),
      }),
    ).rejects.toBeInstanceOf(WorkerUnavailableError);
  });

  it("returns the availability error when the reranker fails", async () => {
    await seedPrincipals();
    await expect(
      ephemeralTurn({
        requestId: "req-avail-rerank",
        vectorize: workingVectorize,
        run: aiStub({ finalReply: BRAIN_NOT_ENOUGH_EVIDENCE, rerankFails: true }),
      }),
    ).rejects.toBeInstanceOf(WorkerUnavailableError);
  });

  it("returns the availability error when every channel fails", async () => {
    await seedPrincipals();
    await expect(
      ephemeralTurn({
        requestId: "req-avail-all",
        corpus: corpusDatabase({ ftsFails: true }),
        vectorize: failingVectorize,
        run: aiStub({ finalReply: BRAIN_NOT_ENOUGH_EVIDENCE, embeddingFails: true }),
      }),
    ).rejects.toBeInstanceOf(WorkerUnavailableError);
  });

  it("answers keyword-only with a recorded degradation when the embedding fails", async () => {
    await seedPrincipals();
    const answer = await ephemeralTurn({
      requestId: "req-avail-embedding",
      vectorize: workingVectorize,
      run: aiStub({
        finalReply: "Annual plans have a fourteen day refund window.[1]",
        embeddingFails: true,
      }),
    });
    expect(answer.structuredAnswer.answerType).toBe("grounded");
    expect(answer.vectorDegradedCount).toBe(1);
  });

  it("records a degradation when Vectorize fails", async () => {
    await seedPrincipals();
    const answer = await ephemeralTurn({
      requestId: "req-avail-vectorize",
      vectorize: failingVectorize,
      run: aiStub({ finalReply: "Annual plans have a fourteen day refund window.[1]" }),
    });
    expect(answer.structuredAnswer.answerType).toBe("grounded");
    expect(answer.vectorDegradedCount).toBe(1);
  });

  it("returns the availability error when the wall-time budget runs out mid-search", async () => {
    await seedPrincipals();
    const realNow = Date.now;
    let offset = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    try {
      await expect(
        ephemeralTurn({
          requestId: "req-avail-wall",
          vectorize: workingVectorize,
          run: aiStub({
            finalReply: "Annual plans have a fourteen day refund window.[1]",
            onRerank: () => {
              offset = AGENT_BUDGETS.wallTimeMs + 1_000;
            },
          }),
        }),
      ).rejects.toBeInstanceOf(WorkerUnavailableError);
    } finally {
      clock.mockRestore();
    }
  });

  it("fails a persisted turn as temporarily unavailable instead of storing a refusal", async () => {
    await seedPrincipals();
    await expect(
      executeTurn({
        operations: env.OPERATIONS_DB,
        corpus: corpusDatabase({ ftsFails: true }),
        vectorize: workingVectorize,
        principal,
        question: "What is the refund window?",
        requestId: "req-avail-persisted",
        lockFor: lockStub(),
        ai: { run: aiStub({ finalReply: BRAIN_NOT_ENOUGH_EVIDENCE }) },
      }),
    ).rejects.toBeInstanceOf(WorkerUnavailableError);

    const stored = await env.OPERATIONS_DB.prepare(
      `SELECT status, error_code, content FROM messages
       WHERE request_id = ? AND role = 'assistant'`,
    )
      .bind("req-avail-persisted")
      .first<{ status: string; error_code: string; content: string }>();
    expect(stored).toMatchObject({ status: "failed", error_code: "PROVIDER_TEMPORARY", content: "" });
  });

  it("maps the availability error to a deterministic retryable 503", async () => {
    const response = workerErrorResponse(new WorkerUnavailableError(), "req-503");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "UNAVAILABLE",
      message: BRAIN_KNOWLEDGE_UNAVAILABLE,
      retryable: true,
      requestId: "req-503",
    });
  });
});
