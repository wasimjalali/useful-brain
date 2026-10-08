import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { AGENT_BUDGETS } from "../../../src/lib/agent/budgets";
import { BRAIN_KNOWLEDGE_UNAVAILABLE, BRAIN_NOT_ENOUGH_EVIDENCE } from "../../../src/lib/agent/host-grounding";
import { executeTurn } from "../../../src/lib/brain/execute-turn";
import { TICKET_DESK } from "../../../src/lib/contracts/approvals";
import {
  WorkerCancelledError,
  WorkerUnavailableError,
  workerErrorResponse,
} from "../../../src/lib/cf/worker-errors";
import { loadConversationForUi } from "../../../src/lib/store/conversation-queries";
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

/** `ftsFailures`: how many FTS queries fail before the channel recovers. */
function corpusDatabase(options: { ftsFails?: boolean; ftsFailures?: number } = {}): CorpusSql {
  let ftsFailuresLeft = options.ftsFailures ?? 0;
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
                if (options.ftsFails || ftsFailuresLeft > 0) {
                  ftsFailuresLeft -= 1;
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

function toolCallReply(name: string, args: Record<string, unknown>, id = "call-1") {
  return {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
      },
    ],
  };
}

/**
 * Workers AI stub: by default the first chat call asks for one search and
 * the second replies with `finalReply`; `chatReplies` replaces that script.
 * Embedding and rerank calls succeed unless told to fail.
 */
function aiStub(options: {
  finalReply?: string;
  chatReplies?: unknown[];
  chatFails?: boolean;
  embeddingFails?: boolean;
  rerankFails?: boolean;
  onRerank?: () => void;
}) {
  let chatCalls = 0;
  const script = options.chatReplies ?? [
    toolCallReply("search_knowledge", { query: "refund window" }),
    { choices: [{ finish_reason: "stop", message: { content: options.finalReply ?? "" } }] },
  ];
  return vi.fn().mockImplementation(async (_model: string, input: Record<string, unknown>) => {
    if ("tools" in input) {
      if (options.chatFails) {
        throw new Error("internal error; reference = vgfnh682ou39cinckuahekmj");
      }
      chatCalls += 1;
      return script[Math.min(chatCalls, script.length) - 1];
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

function lockStub(state: { released: string[] } = { released: [] }) {
  return () => ({
    acquire: async (runId: string) => ({ ok: true as const, runId }),
    cancelled: async () => false,
    release: async (runId: string) => {
      state.released.push(runId);
      return { ok: true as const };
    },
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

async function assistantRow(requestId: string) {
  return env.OPERATIONS_DB.prepare(
    `SELECT id, conversation_id, status, error_code, content FROM messages
     WHERE request_id = ? AND role = 'assistant'`,
  )
    .bind(requestId)
    .first<{ id: string; conversation_id: string; status: string; error_code: string; content: string }>();
}

async function countRows(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.OPERATIONS_DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

function persistedTurn(input: {
  requestId: string;
  run: ReturnType<typeof aiStub>;
  corpus?: CorpusSql;
  lock?: { released: string[] };
  conversationId?: string;
  reuseUserMessageId?: string;
}) {
  return executeTurn({
    operations: env.OPERATIONS_DB,
    corpus: input.corpus ?? corpusDatabase(),
    vectorize: workingVectorize,
    principal,
    question: "What is the refund window?",
    requestId: input.requestId,
    conversationId: input.conversationId,
    reuseUserMessageId: input.reuseUserMessageId,
    lockFor: lockStub(input.lock),
    ai: { run: input.run },
  });
}

describe("persisted turns that hit a backend failure", () => {
  it("fails as temporarily unavailable, releases the lock and answers on retry", async () => {
    await seedPrincipals();
    const lock = { released: [] as string[] };
    await expect(
      persistedTurn({
        requestId: "req-avail-persisted",
        corpus: corpusDatabase({ ftsFails: true }),
        lock,
        run: aiStub({ finalReply: BRAIN_NOT_ENOUGH_EVIDENCE }),
      }),
    ).rejects.toBeInstanceOf(WorkerUnavailableError);

    const failed = await assistantRow("req-avail-persisted");
    expect(failed).toMatchObject({ status: "failed", error_code: "PROVIDER_TEMPORARY", content: "" });
    expect(lock.released).toEqual([failed!.id]);

    // The member's retry re-runs the saved question once the backend is back.
    const userMessage = await env.OPERATIONS_DB.prepare(
      `SELECT id FROM messages WHERE conversation_id = ? AND role = 'user'`,
    )
      .bind(failed!.conversation_id)
      .first<{ id: string }>();
    const retried = await persistedTurn({
      requestId: "req-avail-persisted-retry",
      conversationId: failed!.conversation_id,
      reuseUserMessageId: userMessage!.id,
      run: aiStub({ finalReply: "Annual plans have a fourteen day refund window.[1]" }),
    });
    expect(retried.structuredAnswer.answerType).toBe("grounded");
    expect(await assistantRow("req-avail-persisted-retry")).toMatchObject({ status: "completed" });
  });

  it("keeps the member's stop a cancellation even when the search also failed", async () => {
    await seedPrincipals();
    // turn-cancellation.test.ts cancels around a search that succeeds; this
    // pins the ordering when the run also ended unavailable.
    let cancelled = false;
    const failingThenCancelled: CorpusSql = {
      prepare(sql) {
        if (sql.includes("chunks_fts MATCH")) {
          cancelled = true;
        }
        return corpusDatabase({ ftsFails: true }).prepare(sql);
      },
    };
    await expect(
      executeTurn({
        operations: env.OPERATIONS_DB,
        corpus: failingThenCancelled,
        vectorize: workingVectorize,
        principal,
        question: "What is the refund window?",
        requestId: "req-avail-cancel-order",
        lockFor: () => ({
          acquire: async (runId: string) => ({ ok: true as const, runId }),
          cancelled: async () => cancelled,
          release: async () => ({ ok: true as const }),
        }),
        ai: { run: aiStub({ finalReply: BRAIN_NOT_ENOUGH_EVIDENCE }) },
      }),
    ).rejects.toBeInstanceOf(WorkerCancelledError);
    expect(await assistantRow("req-avail-cancel-order")).toMatchObject({
      status: "failed",
      error_code: "CANCELLED",
    });
  });

  it("names the stored conversation and message in the failure so the client can retry in place", async () => {
    await seedPrincipals();
    let caught: unknown;
    try {
      await persistedTurn({
        requestId: "req-avail-turn-ref",
        corpus: corpusDatabase({ ftsFails: true }),
        run: aiStub({ finalReply: BRAIN_NOT_ENOUGH_EVIDENCE }),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorkerUnavailableError);
    const failed = await assistantRow("req-avail-turn-ref");
    const response = workerErrorResponse(caught, "req-ref");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "UNAVAILABLE",
      message: BRAIN_KNOWLEDGE_UNAVAILABLE,
      retryable: true,
      requestId: "req-ref",
      turn: { conversationId: failed!.conversation_id, assistantMessageId: failed!.id },
    });

    // Reloaded history says why the stored turn failed.
    const conversation = await loadConversationForUi(
      env.OPERATIONS_DB,
      failed!.conversation_id,
      principal.id,
    );
    expect(conversation.turns[0]).toMatchObject({
      answer: null,
      errorRetryable: true,
      errorCode: "PROVIDER_TEMPORARY",
    });
  });

  it("names no stored turn for an ephemeral failure", async () => {
    await seedPrincipals();
    let caught: unknown;
    try {
      await ephemeralTurn({
        requestId: "req-avail-ephemeral-ref",
        corpus: corpusDatabase({ ftsFails: true }),
        vectorize: workingVectorize,
        run: aiStub({ finalReply: BRAIN_NOT_ENOUGH_EVIDENCE }),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorkerUnavailableError);
    expect(await workerErrorResponse(caught, "req-eph").json()).not.toHaveProperty("turn");
  });

  it("records no approval when a search failed before a ticket proposal", async () => {
    await seedPrincipals();
    const ticket = {
      desk: TICKET_DESK,
      priority: "P1",
      customer: "Acme Logistics",
      subject: "Refund stuck after chargeback",
    };
    const run = aiStub({
      chatReplies: [
        toolCallReply("search_knowledge", { query: "refund window" }, "call-1"),
        toolCallReply("search_knowledge", { query: "refund policy" }, "call-2"),
        toolCallReply("create_ticket", ticket, "call-3"),
        { choices: [{ finish_reason: "stop", message: { content: "Done." } }] },
      ],
    });
    await expect(
      persistedTurn({
        requestId: "req-avail-approval",
        // The first search fails, the retry search returns evidence, so the
        // ticket proposal itself is allowed through the search-first gate.
        corpus: corpusDatabase({ ftsFailures: 1 }),
        run,
      }),
    ).rejects.toBeInstanceOf(WorkerUnavailableError);

    // The model did reach the ticket proposal (three chat calls); the
    // pending approval was stopped by the failed search, not by the gate.
    expect(run.mock.calls.filter(([, input]) => "tools" in (input as object))).toHaveLength(3);

    const failed = await assistantRow("req-avail-approval");
    expect(failed).toMatchObject({ status: "failed", error_code: "PROVIDER_TEMPORARY" });
    expect(
      await countRows(`SELECT COUNT(*) AS n FROM approvals WHERE conversation_id = ?`, failed!.conversation_id),
    ).toBe(0);
    expect(
      await countRows(`SELECT COUNT(*) AS n FROM agent_runs WHERE evidence_message_id = ?`, failed!.id),
    ).toBe(0);
  });

  it("fails as temporarily unavailable, not stopped, when the chat model errors", async () => {
    await seedPrincipals();
    const lock = { released: [] as string[] };
    await expect(
      persistedTurn({
        requestId: "req-avail-model-error",
        lock,
        run: aiStub({ chatFails: true }),
      }),
    ).rejects.toBeInstanceOf(WorkerUnavailableError);

    const failed = await assistantRow("req-avail-model-error");
    expect(failed).toMatchObject({ status: "failed", error_code: "PROVIDER_TEMPORARY", content: "" });
    expect(lock.released).toEqual([failed!.id]);
  });

  it("fails as temporarily unavailable, not stopped, when the wall-time budget runs out", async () => {
    await seedPrincipals();
    const realNow = Date.now;
    let offset = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    try {
      await expect(
        persistedTurn({
          requestId: "req-avail-persisted-wall",
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
    expect(await assistantRow("req-avail-persisted-wall")).toMatchObject({
      status: "failed",
      error_code: "PROVIDER_TEMPORARY",
    });
  });
});
