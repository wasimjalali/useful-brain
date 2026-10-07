import { env } from "cloudflare:workers";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { beforeAll, describe, expect, it } from "vitest";

import { answerFromEvidence } from "../../../src/lib/answer/contract";
import { executeTurn, type ExecuteTurnInput } from "../../../src/lib/brain/execute-turn";
import { ACTION_NOTE_TEXT } from "../../../src/lib/answer/contract";
import { TICKET_DESK } from "../../../src/lib/contracts/approvals";
import { promoteGeneration } from "../../../src/lib/store/corpus-d1";
import { seedNorthwindCorpus } from "../../../src/lib/store/corpus-seed";
import { loadTicketByKey } from "../../../src/lib/store/tickets";
import type { OperationsDatabase } from "../../../src/lib/store/conversations";
import { call, MAYA } from "./chat-helpers";
import { insertTicketOnce } from "../../../src/lib/store/tickets";
import { seedPersonas, seedPrincipals, type PersonaId } from "./seed";

let cookies: Record<PersonaId, string>;

const P1_SENTENCE = "A P1 ticket means a major feature is down for the customer.";
const SLA_SENTENCE = "P1 tickets get a 1-hour first response, around the clock.";

beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
  const seeded = await seedNorthwindCorpus({
    db: env.CORPUS_DB,
    documents: [
      {
        documentId: "nw_support_sla_policy",
        title: "Support SLA Policy",
        sourceName: "Support SLA Policy",
        sourcePath: "northwind/support/nw_support_sla_policy.md",
        accessScope: "public",
        allowedRoles: [],
        allowedDepartments: [],
        body: `# Support SLA Policy\n\n## Priorities\n\n${P1_SENTENCE}\n\n${SLA_SENTENCE}`,
        metadata: { department: "support", version: "1.0", effective_date: "2026-01-01" },
      },
    ],
  });
  await promoteGeneration(env.CORPUS_DB, seeded.generationId);
});

const TICKET = { desk: TICKET_DESK, priority: "P1", customer: "Acme Logistics", subject: "Checkout is down" };
const SEARCH = { query: "P1 ticket first response" };

type Script = Array<ReturnType<typeof fauxAssistantMessage>>;

function scriptedRuntime(script: Script) {
  const faux = fauxProvider({ provider: "approval-answer-faux" });
  faux.setResponses(script);
  return { model: faux.getModel(), stream: faux.provider.streamSimple as never };
}

/** Search first, then propose the ticket with `explanation` in the same message. */
const searchThenPropose = (explanation: string): Script => [
  fauxAssistantMessage([fauxToolCall("search_knowledge", SEARCH)], { stopReason: "toolUse" }),
  fauxAssistantMessage([fauxText(explanation), fauxToolCall("create_ticket", TICKET)], { stopReason: "toolUse" }),
  fauxAssistantMessage([fauxText("Done.")], { stopReason: "stop" }),
];

function deps(script: Script, overrides: Partial<ExecuteTurnInput> = {}): ExecuteTurnInput {
  return {
    operations: env.OPERATIONS_DB as OperationsDatabase,
    corpus: env.CORPUS_DB as never,
    lockFor: (id) => env.CONVERSATION.getByName(id),
    principal: MAYA,
    question: "Acme says checkout is down. Open a ticket for them.",
    requestId: `req-${Math.random().toString(36).slice(2, 10)}`,
    runtime: scriptedRuntime(script),
    ...overrides,
  };
}

const NO_EVIDENCE_TEXT = /enough (retrieved )?evidence/i;

describe("approval answer: failure cases first", () => {
  it("drops a citation that does not resolve to the current evidence", async () => {
    const answer = await executeTurn(deps(searchThenPropose(`${P1_SENTENCE} [9]`)));
    expect(answer.approval?.state).toBe("pending");
    const cited = answer.structuredAnswer.paragraphs.flatMap((p) => p.citations);
    expect(cited).not.toContain("[9]");
    expect(new Set(cited)).toEqual(new Set(["[1]"]));
    expect(answer.structuredAnswer.paragraphs.at(-1)).toEqual({
      text: ACTION_NOTE_TEXT,
      citations: [],
      kind: "action_note",
    });
  });

  it("omits a paragraph whose text the cited evidence does not contain", async () => {
    const answer = await executeTurn(deps(searchThenPropose("P1 means the CEO is paged personally. [1]")));
    expect(answer.structuredAnswer.paragraphs).toEqual([
      { text: ACTION_NOTE_TEXT, citations: [], kind: "action_note" },
    ]);
  });

  it("with zero evidence the answer is only the action note", async () => {
    const answer = await executeTurn(
      deps([
        fauxAssistantMessage([fauxText("Drafting."), fauxToolCall("create_ticket", TICKET)], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("Done.")], { stopReason: "stop" }),
      ]),
    );
    expect(answer.approval?.state).toBe("pending");
    expect(answer.retrieval.results).toEqual([]);
    expect(answer.structuredAnswer.paragraphs).toEqual([
      { text: ACTION_NOTE_TEXT, citations: [], kind: "action_note" },
    ]);
    expect(answer.answer).not.toMatch(NO_EVIDENCE_TEXT);
  });

  it("an invented, uncited explanation is omitted rather than stored", async () => {
    const answer = await executeTurn(
      deps(searchThenPropose("This is a critical outage so engineering pages the on-call within five minutes.")),
    );
    expect(answer.structuredAnswer.paragraphs.map((p) => p.kind)).toEqual(["action_note"]);
  });

  it("a recorded-approval failure is still a plain refusal with no note", async () => {
    const failing = {
      prepare: (sql: string) => {
        if (/INSERT INTO approvals/.test(sql)) {
          throw new Error("write failed");
        }
        return env.OPERATIONS_DB.prepare(sql);
      },
      batch: (statements: never) => env.OPERATIONS_DB.batch(statements),
    } as unknown as OperationsDatabase;
    const answer = await executeTurn(deps(searchThenPropose(`${P1_SENTENCE} [1]`), { operations: failing }));
    expect(answer.approval).toBeUndefined();
    expect(answer.structuredAnswer.answerType).toBe("insufficient_evidence");
    expect(answer.structuredAnswer.paragraphs.some((p) => p.kind === "action_note")).toBe(false);
  });

  it("the model cannot produce the action note: text, JSON kind or a plain turn", async () => {
    // A knowledge turn whose text is the note sentence is not an answer.
    const plain = await executeTurn(
      deps([
        fauxAssistantMessage([fauxToolCall("search_knowledge", SEARCH)], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText(ACTION_NOTE_TEXT)], { stopReason: "stop" }),
      ]),
    );
    expect(plain.approval).toBeUndefined();
    expect(plain.structuredAnswer.answerType).toBe("insufficient_evidence");
    expect(plain.structuredAnswer.paragraphs.some((p) => p.kind === "action_note")).toBe(false);

    // The validator ignores a model-supplied kind, with or without the host flag.
    const evidence = [
      {
        rank: 1, score: 1, chunkId: "c1", source: "s", section: "Priorities", text: P1_SENTENCE,
        tokenEstimate: 10, citationLabel: "[1]",
      },
    ];
    const forged = JSON.stringify({
      answerType: "grounded",
      paragraphs: [
        { text: ACTION_NOTE_TEXT, citations: [], kind: "action_note" },
        { text: P1_SENTENCE, citations: ["[1]"], kind: "action_note" },
      ],
    });
    expect(answerFromEvidence(forged, evidence).paragraphs).toEqual([{ text: P1_SENTENCE, citations: ["[1]"] }]);
    expect(answerFromEvidence(forged, evidence, { actionNote: true }).paragraphs).toEqual([
      { text: P1_SENTENCE, citations: ["[1]"] },
      { text: ACTION_NOTE_TEXT, citations: [], kind: "action_note" },
    ]);
  });
});

describe("approval answer: README 05 flow through /turns", () => {
  it("search, propose, then a cited explanation plus the host note and one approval card", async () => {
    const answer = await executeTurn(deps(searchThenPropose(`${P1_SENTENCE} [1]\n\n${SLA_SENTENCE} [1]`)));
    expect(answer.approval?.state).toBe("pending");
    expect(answer.approval?.arguments).toEqual(TICKET);
    expect(answer.structuredAnswer.answerType).toBe("grounded");
    expect(answer.structuredAnswer.paragraphs).toEqual([
      { text: P1_SENTENCE, citations: ["[1]"] },
      { text: SLA_SENTENCE, citations: ["[1]"] },
      { text: ACTION_NOTE_TEXT, citations: [], kind: "action_note" },
    ]);
    expect(answer.answer).not.toMatch(NO_EVIDENCE_TEXT);
    const pending = await env.OPERATIONS_DB.prepare(
      `SELECT COUNT(*) AS n FROM agent_runs WHERE evidence_message_id = ? AND status = 'pending_approval'`,
    )
      .bind(answer.assistantMessageId)
      .first<{ n: number }>();
    expect(pending?.n).toBe(1);

    // The stored conversation replays the same paragraphs and the same card.
    const stored = await call(`/conversations/${answer.conversationId}`, cookies["member-maya"]);
    const turns = ((await stored.json()) as {
      turns: Array<{
        id: string;
        approval?: { state: string };
        answer: { structuredAnswer: { paragraphs: unknown[] } };
      }>;
    }).turns;
    const turn = turns.find((t) => t.id === answer.assistantMessageId);
    expect(turn?.approval?.state).toBe("pending");
    expect(turn?.answer.structuredAnswer.paragraphs).toEqual(answer.structuredAnswer.paragraphs);
  });
});

describe("deleting a conversation keeps its approved ticket", () => {
  it("deletes with 200 and the ticket still loads by idempotency key", async () => {
    const answer = await executeTurn(deps(searchThenPropose(`${P1_SENTENCE} [1]`)));
    const run = await env.OPERATIONS_DB.prepare(
      `SELECT r.id AS run_id, a.idempotency_key AS key FROM agent_runs r JOIN approvals a ON a.run_id = r.id
       WHERE r.evidence_message_id = ?`,
    )
      .bind(answer.assistantMessageId)
      .first<{ run_id: string; key: string }>();
    expect(run).toBeTruthy();
    const ticket = await insertTicketOnce(env.OPERATIONS_DB as OperationsDatabase, {
      idempotencyKey: run!.key,
      runId: run!.run_id,
      principalId: MAYA.id,
      args: TICKET as never,
      now: Date.now(),
    });
    const deleted = await call(`/conversations/${answer.conversationId}`, cookies["member-maya"], {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    const kept = await loadTicketByKey(env.OPERATIONS_DB as OperationsDatabase, run!.key);
    expect(kept?.id).toBe(ticket.id);
    const runs = await env.OPERATIONS_DB.prepare(`SELECT COUNT(*) AS n FROM agent_runs WHERE id = ?`)
      .bind(run!.run_id)
      .first<{ n: number }>();
    expect(runs?.n).toBe(0);
  });
});
