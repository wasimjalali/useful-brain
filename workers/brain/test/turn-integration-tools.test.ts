import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { WorkerValidationError } from "../../../src/lib/cf/worker-errors";
import { executeTurn, type ExecuteTurnInput } from "../../../src/lib/brain/execute-turn";
import { TICKET_DESK } from "../../../src/lib/contracts/approvals";
import { recordedAiRun, resetAiHealthThrottle } from "../../../src/lib/models/ai-health";
import { withAiHealth } from "../../../src/lib/models/ai-health-wrap";
import type { OperationsDatabase } from "../../../src/lib/store/conversations";
import worker from "../src";
import { call, MAYA, PRIYA, seedChatCorpus } from "./chat-helpers";
import { seedPersonas, seedPrincipals, type PersonaId } from "./seed";

let cookies: Record<PersonaId, string>;

beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
  await seedChatCorpus();
});

beforeEach(() => {
  resetAiHealthThrottle();
});

const TICKET = { desk: TICKET_DESK, priority: "P1", customer: "Acme Logistics", subject: "Refund stuck after chargeback" };

type Script = Array<ReturnType<typeof fauxAssistantMessage>>;

/** A scripted chat runtime. `seen` collects every context the model was shown. */
function scriptedRuntime(script: Script, seen: unknown[] = []) {
  const faux = fauxProvider({ provider: "turn-integration-faux" });
  faux.setResponses(script);
  return {
    model: faux.getModel(),
    stream: ((model: never, context: unknown, options: never) => {
      seen.push(context);
      return faux.provider.streamSimple(model, context as never, options);
    }) as never,
  };
}

/** The ticket tool is blocked until a search returned evidence, so a proposal searches first. */
const proposeTicket = (): Script => [
  fauxAssistantMessage([fauxToolCall("search_knowledge", { query: "refund escalation retention" })], {
    stopReason: "toolUse",
  }),
  fauxAssistantMessage([fauxText("Drafting."), fauxToolCall("create_ticket", TICKET)], { stopReason: "toolUse" }),
  fauxAssistantMessage([fauxText("Done.")], { stopReason: "stop" }),
];

const proposeTicketWithoutSearch = (): Script => [
  fauxAssistantMessage([fauxText("Drafting."), fauxToolCall("create_ticket", TICKET)], { stopReason: "toolUse" }),
  fauxAssistantMessage([fauxText("Done.")], { stopReason: "stop" }),
];

function lock(conversationId: string) {
  return env.CONVERSATION.getByName(conversationId);
}

function deps(overrides: Partial<ExecuteTurnInput> = {}): ExecuteTurnInput {
  return {
    operations: env.OPERATIONS_DB as OperationsDatabase,
    corpus: env.CORPUS_DB as never,
    lockFor: lock,
    principal: MAYA,
    question: "Open a ticket for Acme about the stuck refund",
    requestId: `req-${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  };
}

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.OPERATIONS_DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

describe("create_ticket in the live turn", () => {
  it("records a pending approval and returns the card, and the ticket is not created", async () => {
    const answer = await executeTurn(deps({ runtime: scriptedRuntime(proposeTicket()) }));
    expect(answer.approval?.state).toBe("pending");
    expect(answer.approval?.tool).toBe("create_ticket");
    expect(answer.approval?.arguments).toEqual(TICKET);
    // No explanation was cited, so the grounded part is omitted: only the host note remains.
    expect(answer.structuredAnswer.paragraphs.map((p) => p.kind)).toEqual(["action_note"]);
    expect(answer.answer).not.toMatch(/enough (retrieved )?evidence/i);
    expect(await count(`SELECT COUNT(*) AS n FROM tickets`)).toBe(0);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM agent_runs WHERE evidence_message_id = ? AND status = 'pending_approval'`,
        answer.assistantMessageId,
      ),
    ).toBe(1);
  });

  it("refuses a ticket proposed before any search: no approval row, no run, no ticket", async () => {
    const answer = await executeTurn(deps({ runtime: scriptedRuntime(proposeTicketWithoutSearch()) }));
    expect(answer.approval).toBeUndefined();
    expect(answer.structuredAnswer.answerType).toBe("insufficient_evidence");
    expect(await count(`SELECT COUNT(*) AS n FROM approvals WHERE conversation_id = ?`, answer.conversationId)).toBe(0);
    expect(
      await count(`SELECT COUNT(*) AS n FROM agent_runs WHERE evidence_message_id = ?`, answer.assistantMessageId),
    ).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM tickets`)).toBe(0);
  });

  it("shows the same card when the conversation is loaded, to its owner only", async () => {
    const answer = await executeTurn(deps({ runtime: scriptedRuntime(proposeTicket()) }));
    const mine = await call(`/conversations/${answer.conversationId}`, cookies["member-maya"]);
    expect(mine.status).toBe(200);
    const turns = ((await mine.json()) as { turns: Array<{ id: string; approval?: { state: string } }> }).turns;
    expect(turns.find((turn) => turn.id === answer.assistantMessageId)?.approval?.state).toBe("pending");
    const theirs = await call(`/conversations/${answer.conversationId}`, cookies["member-priya"]);
    expect(theirs.status).toBe(403);
  });

  it("treats a failure while recording the approval as a refusal with no half run", async () => {
    const failing = {
      prepare: (sql: string) => {
        if (/INSERT INTO approvals/.test(sql)) {
          throw new Error("write failed");
        }
        return env.OPERATIONS_DB.prepare(sql);
      },
      batch: (statements: never) => env.OPERATIONS_DB.batch(statements),
    } as unknown as OperationsDatabase;
    const answer = await executeTurn(
      deps({ operations: failing, runtime: scriptedRuntime(proposeTicket()) }),
    );
    expect(answer.approval).toBeUndefined();
    expect(answer.structuredAnswer.answerType).toBe("insufficient_evidence");
    expect(answer.retrieval.results).toEqual([]);
    expect(
      await count(`SELECT COUNT(*) AS n FROM approvals WHERE conversation_id = ?`, answer.conversationId),
    ).toBe(0);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM agent_runs WHERE evidence_message_id = ? AND status IN ('running','pending_approval')`,
        answer.assistantMessageId,
      ),
    ).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM tickets`)).toBe(0);
  });

  it("does not offer the tool to an ephemeral turn", async () => {
    const before = await count(`SELECT COUNT(*) AS n FROM agent_runs`);
    const answer = await executeTurn(
      deps({ persistConversation: false, runtime: scriptedRuntime(proposeTicket()) }),
    );
    expect(answer.approval).toBeUndefined();
    expect(answer.assistantMessageId).toBeUndefined();
    expect(await count(`SELECT COUNT(*) AS n FROM agent_runs`)).toBe(before);
  });
});

describe("scopeDocumentId", () => {
  it("is NOT_FOUND for a document the asker cannot read, and stores nothing", async () => {
    const before = await count(`SELECT COUNT(*) AS n FROM conversations`);
    const missing = await call("/turns", cookies["member-maya"], {
      json: { question: "Who approves budgets?", requestId: "scope-unreadable", scopeDocumentId: "doc-finance-policy" },
    });
    expect(missing.status).toBe(404);
    const unknown = await call("/turns", cookies["member-maya"], {
      json: { question: "Who approves budgets?", requestId: "scope-unknown", scopeDocumentId: "doc-nope" },
    });
    expect(unknown.status).toBe(404);
    expect(await count(`SELECT COUNT(*) AS n FROM conversations`)).toBe(before);
  });

  it("rejects a malformed id", async () => {
    const response = await call("/turns", cookies["member-maya"], {
      json: { question: "Anything", requestId: "scope-bad", scopeDocumentId: 42 },
    });
    expect(response.status).toBe(400);
  });

  it("binds the scope to the request id: a replay with another or no scope is rejected", async () => {
    const searchOnly = () =>
      scriptedRuntime([
        fauxAssistantMessage([fauxToolCall("search_knowledge", { query: "security password handbook leave" })], {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage([fauxText("x")], { stopReason: "stop" }),
      ]);
    const requestId = `req-scope-bind-${Math.random().toString(36).slice(2, 8)}`;
    const first = await executeTurn(
      deps({ requestId, runtime: searchOnly(), scopeDocumentId: "doc-public-security" }),
    );
    expect(first.retrieval.results.length).toBeGreaterThan(0);
    await expect(
      executeTurn(deps({ requestId, runtime: searchOnly(), scopeDocumentId: "doc-public-handbook" })),
    ).rejects.toBeInstanceOf(WorkerValidationError);
    await expect(executeTurn(deps({ requestId, runtime: searchOnly() }))).rejects.toBeInstanceOf(
      WorkerValidationError,
    );
    // The same scope is still a normal replay of the stored answer.
    const replay = await executeTurn(
      deps({ requestId, runtime: searchOnly(), scopeDocumentId: "doc-public-security" }),
    );
    expect(replay.assistantMessageId).toBe(first.assistantMessageId);
  });

  it("restricts both retrieval channels to the document, after the ACL", async () => {
    const runtime = () =>
      scriptedRuntime([
        fauxAssistantMessage([fauxToolCall("search_knowledge", { query: "security password handbook leave" })], {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage([fauxText("x")], { stopReason: "stop" }),
      ]);
    const unscoped = await executeTurn(deps({ runtime: runtime() }));
    const scoped = await executeTurn(deps({ runtime: runtime(), scopeDocumentId: "doc-public-security" }));
    const unscopedDocs = new Set(unscoped.retrieval.results.map((item) => item.documentId));
    expect(unscopedDocs.size).toBeGreaterThan(1);
    expect(scoped.retrieval.results.length).toBeGreaterThan(0);
    expect(new Set(scoped.retrieval.results.map((item) => item.documentId))).toEqual(
      new Set(["doc-public-security"]),
    );
  });
});

describe("admin-only evidence fields", () => {
  const ADMIN = {
    id: "member-jordan",
    subject: "jordan.ellis@northwind.example",
    kind: "user" as const,
    roles: ["admin"],
    departments: ["operations"],
  };
  const search = () =>
    scriptedRuntime([
      fauxAssistantMessage([fauxToolCall("search_knowledge", { query: "security password handbook leave" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxText("x")], { stopReason: "stop" }),
    ]);

  it("strips scores, chunk ids and the generation id from a member's response, live and on replay", async () => {
    const requestId = `req-member-strip-${Math.random().toString(36).slice(2, 8)}`;
    const live = await executeTurn(deps({ requestId, runtime: search() }));
    const replay = await executeTurn(deps({ requestId, runtime: search() }));
    for (const answer of [live, replay]) {
      expect(answer.retrieval.results.length).toBeGreaterThan(0);
      expect(answer.corpusGenerationId).toBeUndefined();
      for (const result of answer.retrieval.results) {
        expect(result.chunkId).toBe(result.citationLabel);
        expect(result.score).toBe(0);
        for (const key of ["vectorScore", "keywordScore", "fusedScore", "rerankScore"]) {
          expect(result).not.toHaveProperty(key);
        }
      }
    }
    // Citations still resolve: labels and text are untouched.
    expect(live.retrieval.results.map((r) => r.citationLabel)).toEqual(
      replay.retrieval.results.map((r) => r.citationLabel),
    );
  });

  it("keeps them for an admin", async () => {
    const answer = await executeTurn(deps({ principal: ADMIN, runtime: search() }));
    expect(answer.corpusGenerationId).toBeTruthy();
    const first = answer.retrieval.results[0];
    expect(first.chunkId).not.toBe(first.citationLabel);
    expect(first.rerankScore ?? first.keywordScore ?? first.vectorScore).not.toBeUndefined();
  });

  it("strips them from a member's ephemeral turn too", async () => {
    const answer = await executeTurn(deps({ persistConversation: false, runtime: search() }));
    expect(answer.retrieval.results.length).toBeGreaterThan(0);
    for (const result of answer.retrieval.results) {
      expect(result.chunkId).toBe(result.citationLabel);
      expect(result).not.toHaveProperty("keywordScore");
    }
  });
});

describe("turn steps", () => {
  it("stores ids, counts and scores only, and a rewrite as a token count", async () => {
    const question = "What is the escalation timeline for the incident runbook?";
    const rewritten = "incident runbook paging";
    const answer = await executeTurn(
      deps({
        question,
        runtime: scriptedRuntime([
          fauxAssistantMessage([fauxToolCall("search_knowledge", { query: rewritten })], { stopReason: "toolUse" }),
          fauxAssistantMessage([fauxText("x")], { stopReason: "stop" }),
        ]),
      }),
    );
    const rows = (
      await env.OPERATIONS_DB.prepare(
        `SELECT seq, step, detail_json, duration_ms FROM turn_steps WHERE message_id = ? ORDER BY seq`,
      )
        .bind(answer.assistantMessageId)
        .all<{ seq: number; step: string; detail_json: string; duration_ms: number | null }>()
    ).results;
    expect(rows.map((row) => row.step)).toEqual(["rewrite", "retrieve", "rerank", "generate", "result"]);
    const all = rows.map((row) => row.detail_json).join("");
    expect(all).not.toContain("runbook");
    expect(all).not.toContain("escalation");
    expect(JSON.parse(rows[0].detail_json)).toEqual({ queryTokens: 3 });
    expect(JSON.parse(rows[1].detail_json)).toMatchObject({ mode: "hybrid" });
    expect(rows[1].duration_ms).not.toBeNull();
    expect(JSON.parse(rows[4].detail_json)).toHaveProperty("answerType");
  });

  it("records the proposal and the approval state for a ticket turn", async () => {
    const answer = await executeTurn(deps({ runtime: scriptedRuntime(proposeTicket()) }));
    const steps = (
      await env.OPERATIONS_DB.prepare(`SELECT step, detail_json FROM turn_steps WHERE message_id = ? ORDER BY seq`)
        .bind(answer.assistantMessageId)
        .all<{ step: string; detail_json: string }>()
    ).results;
    expect(steps.map((row) => row.step)).toEqual([
      "rewrite",
      "retrieve",
      "rerank",
      "generate",
      "tool_call",
      "approval",
      "result",
    ]);
    expect(JSON.parse(steps[4].detail_json)).toEqual({ tool: "create_ticket" });
    expect(JSON.parse(steps[5].detail_json)).toEqual({ state: "pending" });
    expect(steps.map((row) => row.detail_json).join("")).not.toContain("Acme");
  });

  it("a step write failure never fails the turn", async () => {
    const failing = {
      prepare: (sql: string) => {
        if (/INSERT INTO turn_steps/.test(sql)) {
          throw new Error("trace write failed");
        }
        return env.OPERATIONS_DB.prepare(sql);
      },
      batch: (statements: never) => env.OPERATIONS_DB.batch(statements),
    } as unknown as OperationsDatabase;
    const answer = await executeTurn(deps({ operations: failing, runtime: scriptedRuntime(proposeTicket()) }));
    expect(answer.assistantMessageId).toBeTruthy();
  });
});

describe("best candidate department", () => {
  const rerankStub = {
    run: async (model: string, payload: Record<string, unknown>) => {
      if (model.includes("reranker")) {
        const contexts = (payload.contexts as unknown[]).length;
        return { response: Array.from({ length: contexts }, (_, id) => ({ id, score: 0.01 })) };
      }
      return { data: [] };
    },
  };

  it("records the department of the best candidate the floor dropped, for a refusal", async () => {
    const answer = await executeTurn(
      deps({
        ai: rerankStub as never,
        question: "incident runbook paging",
        runtime: scriptedRuntime([
          fauxAssistantMessage([fauxToolCall("search_knowledge", { query: "incident runbook paging" })], {
            stopReason: "toolUse",
          }),
          fauxAssistantMessage([fauxText("x")], { stopReason: "stop" }),
        ]),
      }),
    );
    expect(answer.structuredAnswer.answerType).toBe("insufficient_evidence");
    const row = await env.OPERATIONS_DB.prepare(`SELECT best_candidate_department AS d FROM messages WHERE id = ?`)
      .bind(answer.assistantMessageId)
      .first<{ d: string | null }>();
    expect(row?.d).toBe("engineering");
  });

  it("omits it when no candidate was dropped", async () => {
    const answer = await executeTurn(
      deps({ principal: PRIYA, question: "nothing matches zzzqqq", runtime: scriptedRuntime(proposeTicket()) }),
    );
    const row = await env.OPERATIONS_DB.prepare(`SELECT best_candidate_department AS d FROM messages WHERE id = ?`)
      .bind(answer.assistantMessageId)
      .first<{ d: string | null }>();
    expect(row?.d).toBeNull();
  });
});

describe("AI health", () => {
  const events = async () =>
    (
      await env.OPERATIONS_DB.prepare(`SELECT status FROM service_health_events ORDER BY seq`).all<{ status: string }>()
    ).results.map((row) => row.status);

  it("writes every failure, rethrows it, and at most one success per minute", async () => {
    await env.OPERATIONS_DB.prepare(`DELETE FROM service_health_events`).run();
    let fail = false;
    const wrapped = withAiHealth(env.OPERATIONS_DB as OperationsDatabase, {
      run: async () => {
        if (fail) {
          throw new Error("429 too many requests");
        }
        return { ok: true };
      },
    });
    await wrapped.run("m", {});
    await wrapped.run("m", {});
    await wrapped.run("m", {});
    expect(await events()).toEqual(["ok"]);
    fail = true;
    await expect(wrapped.run("m", {})).rejects.toThrow("429");
    await expect(wrapped.run("m", {})).rejects.toThrow("429");
    expect(await events()).toEqual(["ok", "error", "error"]);
  });

  it("always records the first success after a failure and throttles only consecutive successes", async () => {
    await env.OPERATIONS_DB.prepare(`DELETE FROM service_health_events`).run();
    const db = env.OPERATIONS_DB as OperationsDatabase;
    const options = { successMinIntervalMs: 60_000 };
    await recordedAiRun(db, async () => 1, () => 1_000, options);
    await expect(recordedAiRun(db, async () => Promise.reject(new Error("boom")), () => 2_000, options)).rejects.toThrow(
      "boom",
    );
    // Recovery one second after the failure is inside the success interval, yet must be written.
    await recordedAiRun(db, async () => 2, () => 3_000, options);
    // The next consecutive success is throttled.
    await recordedAiRun(db, async () => 3, () => 4_000, options);
    expect(await events()).toEqual(["ok", "error", "ok"]);
  });

  it("does not record a caller-initiated abort as a Workers AI error, but still records a real timeout", async () => {
    await env.OPERATIONS_DB.prepare(`DELETE FROM service_health_events`).run();
    const db = env.OPERATIONS_DB as OperationsDatabase;
    const stop = new AbortController();
    stop.abort();
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    await expect(
      recordedAiRun(db, async () => Promise.reject(abortError), () => 1_000, { signal: stop.signal }),
    ).rejects.toBe(abortError);
    // An abort with no signal at hand is still an abort, never a timeout.
    await expect(recordedAiRun(db, async () => Promise.reject(abortError), () => 1_500)).rejects.toBe(abortError);
    expect(await events()).toEqual([]);
    const timeout = AbortSignal.timeout(0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(
      recordedAiRun(db, async () => Promise.reject(timeout.reason), () => 2_000, { signal: timeout }),
    ).rejects.toBeDefined();
    expect(await events()).toEqual(["error"]);
    const row = await env.OPERATIONS_DB.prepare(`SELECT code FROM service_health_events`).first<{ code: string }>();
    expect(row?.code).toBe("timeout");
  });

  it("a turn through the live pipeline records the rerank call", async () => {
    await env.OPERATIONS_DB.prepare(`DELETE FROM service_health_events`).run();
    await executeTurn(
      deps({
        ai: rerankStub2 as never,
        question: "incident runbook paging",
        runtime: scriptedRuntime([
          fauxAssistantMessage([fauxToolCall("search_knowledge", { query: "incident runbook paging" })], {
            stopReason: "toolUse",
          }),
          fauxAssistantMessage([fauxText("x")], { stopReason: "stop" }),
        ]),
      }),
    );
    expect((await events()).length).toBe(1);
  });
});

const rerankStub2 = {
  run: async (model: string, payload: Record<string, unknown>) => {
    if (model.includes("reranker")) {
      return { response: (payload.contexts as unknown[]).map((_, id) => ({ id, score: 0.9 })) };
    }
    return { data: [] };
  },
};

describe("scheduled pruning", () => {
  it("deletes health events older than 24 hours and keeps recent ones", async () => {
    const db = env.OPERATIONS_DB;
    await db.prepare(`DELETE FROM service_health_events`).run();
    const now = Date.now();
    await db.batch([
      db.prepare(`INSERT INTO service_health_events (service, status, code, at) VALUES ('workers_ai','ok','last_call_ok',?)`).bind(now - 25 * 3600_000),
      db.prepare(`INSERT INTO service_health_events (service, status, code, at) VALUES ('workers_ai','ok','last_call_ok',?)`).bind(now - 23 * 3600_000),
    ]);
    const ctx = createExecutionContext();
    await worker.scheduled({}, env);
    await waitOnExecutionContext(ctx);
    const left = (await db.prepare(`SELECT at FROM service_health_events`).all<{ at: number }>()).results;
    expect(left.length).toBe(1);
    expect(left[0].at).toBeGreaterThan(now - 24 * 3600_000);
  });
});
