import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { executeTurn } from "../../../src/lib/brain/execute-turn";
import {
  WorkerBusyError,
  WorkerCancelledError,
} from "../../../src/lib/cf/worker-errors";
import type { CorpusSql } from "../../../src/lib/retrieve/cloudflare-pipeline";
import { failTurn } from "../../../src/lib/store/conversations";
import { seedPrincipals } from "./seed";

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

function corpusDatabase(): CorpusSql {
  return {
    prepare(sql) {
      const statement = {
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
                rows = [{ chunk_id: chunkRow.chunk_id }];
              } else if (sql.includes("SELECT vector_id, chunk_id")) {
                rows = [];
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
      return statement;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockStub(state: { cancelled: boolean; released: boolean }) {
  return () => ({
    acquire: async (runId: string) => ({ ok: true as const, runId }),
    cancelled: async () => state.cancelled,
    release: async () => {
      state.released = true;
      return { ok: true as const };
    },
  });
}

async function storedTurn(requestId: string) {
  return env.OPERATIONS_DB.prepare(
    `SELECT conversation_id, status, error_code, content
     FROM messages WHERE request_id = ? AND role = 'assistant'`,
  )
    .bind(requestId)
    .first<{
      conversation_id: string;
      status: string;
      error_code: string;
      content: string;
    }>();
}

describe("turn cancellation boundaries", () => {
  it("aborts a turn whose cancellation was claimed before the lock", async () => {
    await seedPrincipals();
    let released = false;
    await expect(
      executeTurn({
        operations: env.OPERATIONS_DB,
        principal,
        question: "Stop this answer",
        requestId: "req-cancel-before-lock",
        lockFor: () => ({
          acquire: async (runId) => {
            // The /cancel path raced the lock: the pending row is already
            // marked failed before the run is allowed to start.
            await failTurn(env.OPERATIONS_DB, {
              assistantMessageId: runId,
              ownerPrincipalId: "principal-alice",
              errorCode: "CANCELLED",
              now: Date.now(),
            });
            return { ok: true as const, runId };
          },
          cancelled: async () => true,
          release: async () => {
            released = true;
            return { ok: true as const };
          },
        }),
        ai: {
          run: async () => {
            throw new Error("model must not run after a pre-lock cancel");
          },
        },
      }),
    ).rejects.toBeInstanceOf(WorkerCancelledError);

    expect(released).toBe(true);
    expect(await storedTurn("req-cancel-before-lock")).toMatchObject({
      status: "failed",
      error_code: "CANCELLED",
      content: "",
    });
  });

  it("discards the run when cancellation lands during retrieval", async () => {
    await seedPrincipals();
    const state = { cancelled: false, released: false };
    const run = vi.fn().mockImplementation(async (_model: string, input: Record<string, unknown>) => {
      if ("tools" in input) {
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
                      arguments: JSON.stringify({ query: "refund" }),
                    },
                  },
                ],
              },
            },
          ],
        };
      }
      // The rerank call ({query, contexts}) inside retrieval: cancellation
      // lands mid-request and the late scores are discarded instead of fused.
      state.cancelled = true;
      await sleep(400);
      return { response: [{ id: 0, score: 0.95 }] };
    });

    await expect(
      executeTurn({
        operations: env.OPERATIONS_DB,
        corpus: corpusDatabase(),
        principal,
        question: "What is the refund window?",
        requestId: "req-cancel-retrieval",
        lockFor: lockStub(state),
        ai: { run },
      }),
    ).rejects.toBeInstanceOf(WorkerCancelledError);

    // Only the chat and rerank calls ran: no follow-up model call starts
    // once the turn is cancelled.
    expect(run).toHaveBeenCalledTimes(2);
    expect(state.released).toBe(true);
    expect(await storedTurn("req-cancel-retrieval")).toMatchObject({
      status: "failed",
      error_code: "CANCELLED",
      content: "",
    });
    // A replayed request for a cancelled turn never surfaces an answer.
    await expect(
      executeTurn({
        operations: env.OPERATIONS_DB,
        corpus: corpusDatabase(),
        principal,
        question: "What is the refund window?",
        requestId: "req-cancel-retrieval",
        lockFor: lockStub(state),
        ai: { run },
      }),
    ).rejects.toBeInstanceOf(WorkerBusyError);
  });

  it("never starts a second repair call when cancellation lands during repair", async () => {
    await seedPrincipals();
    const state = { cancelled: false, released: false };
    let chatCalls = 0;
    const run = vi.fn().mockImplementation(async (_model: string, input: Record<string, unknown>) => {
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
                        arguments: JSON.stringify({ query: "refund" }),
                      },
                    },
                  ],
                },
              },
            ],
          };
        }
        // A paraphrased draft fails citation grounding, so the host asks the
        // repair model for a verbatim quote.
        return {
          choices: [
            {
              finish_reason: "stop",
              message: { content: "Customers get two weeks to change their mind." },
            },
          ],
        };
      }
      if ("contexts" in input) {
        return { response: [{ id: 0, score: 0.95 }] };
      }
      // The citation-repair call ({messages}, no tools): cancellation lands
      // while it is in flight and the late repaired text must not be adopted
      // or persisted.
      state.cancelled = true;
      await sleep(400);
      return {
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                quotes: [
                  {
                    quote: "Annual plans have a fourteen day refund window.",
                    citation: "[1]",
                  },
                ],
              }),
            },
          },
        ],
      };
    });

    await expect(
      executeTurn({
        operations: env.OPERATIONS_DB,
        corpus: corpusDatabase(),
        principal,
        question: "What is the refund window?",
        requestId: "req-cancel-repair",
        lockFor: lockStub(state),
        ai: { run },
      }),
    ).rejects.toBeInstanceOf(WorkerCancelledError);

    // chat -> rerank -> chat -> repair, then nothing further.
    expect(run).toHaveBeenCalledTimes(4);
    expect(state.released).toBe(true);
    expect(await storedTurn("req-cancel-repair")).toMatchObject({
      status: "failed",
      error_code: "CANCELLED",
      content: "",
    });
  });

  it("discards a completed draft when cancellation lands at the completion boundary", async () => {
    await seedPrincipals();
    const state = { cancelled: false, released: false };
    let chatCalls = 0;
    const run = vi.fn().mockImplementation(async (_model: string, input: Record<string, unknown>) => {
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
                        arguments: JSON.stringify({ query: "refund" }),
                      },
                    },
                  ],
                },
              },
            ],
          };
        }
        // The final draft is valid, but the turn is cancelled before the
        // completion boundary accepts it.
        state.cancelled = true;
        return {
          choices: [
            {
              finish_reason: "stop",
              message: { content: "Annual plans have a fourteen day refund window.[1]" },
            },
          ],
        };
      }
      // The rerank call ({query, contexts}).
      return { response: [{ id: 0, score: 0.95 }] };
    });

    await expect(
      executeTurn({
        operations: env.OPERATIONS_DB,
        corpus: corpusDatabase(),
        principal,
        question: "What is the refund window?",
        requestId: "req-cancel-boundary",
        lockFor: lockStub(state),
        ai: { run },
      }),
    ).rejects.toBeInstanceOf(WorkerCancelledError);

    expect(state.released).toBe(true);
    expect(await storedTurn("req-cancel-boundary")).toMatchObject({
      status: "failed",
      error_code: "CANCELLED",
      content: "",
    });
  });
});
