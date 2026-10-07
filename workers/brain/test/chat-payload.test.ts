import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { call, seedChatCorpus, seedGroundedAnswer } from "./chat-helpers";
import { seedPersonas, seedPrincipals, type PersonaId } from "./seed";

let cookies: Record<PersonaId, string>;
let generationId: string;

beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
  generationId = (await seedChatCorpus()).generationId;
});

type Evidence = {
  chunkId: string;
  text: string;
  source: string;
  documentId: string | null;
  documentTitle: string | null;
};
type Turn = {
  id: string;
  question: string;
  error: string | null;
  cancelled?: boolean;
  answerType?: string;
  latencyMs?: number | null;
  passagesRetrieved?: number | null;
  feedback?: "up" | "down" | null;
  documentRequested?: boolean;
  answer: {
    structuredAnswer: { answerType: string };
    retrieval: { results: Evidence[] };
  } | null;
};

async function ask(cookie: string, question: string, requestId: string) {
  const res = await call("/turns", cookie, { json: { question, requestId } });
  return (await res.json()) as { conversationId: string; assistantMessageId: string };
}

async function turnsOf(conversationId: string, cookie: string): Promise<Turn[]> {
  const res = await call(`/conversations/${conversationId}`, cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { turns: Turn[] }).turns;
}

describe("GET /conversations/:id additive fields", () => {
  it("a grounded turn carries metrics, defaults and per-evidence document id and title", async () => {
    const turn = await seedGroundedAnswer({ owner: "member-maya", requestId: "payload-grounded", generationId });
    const [shown] = await turnsOf(turn.conversationId, cookies["member-maya"]);
    expect(shown.answerType).toBe("grounded");
    expect(shown.latencyMs).toBe(1234);
    expect(shown.passagesRetrieved).toBe(2);
    expect(shown.feedback).toBeNull();
    expect(shown.documentRequested).toBe(false);

    const stored = (
      await env.OPERATIONS_DB.prepare(
        `SELECT chunk_id, text, document_id FROM evidence_snapshots WHERE message_id = ? ORDER BY rank`,
      )
        .bind(turn.assistantMessageId)
        .all<{ chunk_id: string; text: string; document_id: string | null }>()
    ).results;
    const results = shown.answer!.retrieval.results;
    expect(results.map((r) => r.chunkId)).toEqual(stored.map((r) => r.chunk_id));
    for (const [index, row] of results.entries()) {
      expect(row.text).toBe(stored[index].text);
      expect(row.documentId).toBe(stored[index].document_id);
    }
    const handbook = results.find((r) => r.documentId === "doc-public-handbook");
    expect(handbook?.documentTitle).toBe("Employee Handbook");
  });

  it("evidence text comes from the stored snapshot even after the live chunks change", async () => {
    const turn = await seedGroundedAnswer({ owner: "member-maya", requestId: "payload-snapshot", generationId });
    await env.CORPUS_DB.prepare(`UPDATE chunks SET content = 'REWRITTEN AFTER THE ANSWER'`).run();
    const [shown] = await turnsOf(turn.conversationId, cookies["member-maya"]);
    expect(shown.answer!.retrieval.results.length).toBeGreaterThan(0);
    for (const row of shown.answer!.retrieval.results) {
      expect(row.text).not.toContain("REWRITTEN");
    }
  });

  it("documentTitle is null when the catalog has no row for that document and generation", async () => {
    const turn = await seedGroundedAnswer({ owner: "member-maya", requestId: "payload-notitle", generationId });
    await env.CORPUS_DB.prepare(`DELETE FROM document_catalog`).run();
    const [shown] = await turnsOf(turn.conversationId, cookies["member-maya"]);
    for (const row of shown.answer!.retrieval.results) {
      expect(row.documentTitle).toBeNull();
    }
  });

  it("reports feedback and a requested document for the owner only", async () => {
    const turn = await ask(cookies["member-priya"], "Zyxwv quasar plimsoll?", "payload-insufficient");
    let [shown] = await turnsOf(turn.conversationId, cookies["member-priya"]);
    expect(shown.answerType).toBe("insufficient_evidence");
    expect(shown.documentRequested).toBe(false);

    await call(`/messages/${turn.assistantMessageId}/feedback`, cookies["member-priya"], { json: { value: "down" } });
    await call(`/messages/${turn.assistantMessageId}/request-document`, cookies["member-priya"], { method: "POST" });
    [shown] = await turnsOf(turn.conversationId, cookies["member-priya"]);
    expect(shown.feedback).toBe("down");
    expect(shown.documentRequested).toBe(true);

    // The same question later on a new answer still reads as requested.
    const again = await ask(cookies["member-priya"], "zyxwv  QUASAR plimsoll?", "payload-insufficient-2");
    const [repeat] = await turnsOf(again.conversationId, cookies["member-priya"]);
    expect(repeat.documentRequested).toBe(true);
    expect(repeat.feedback).toBeNull();

    // Another member's feedback on the same message is never shown to this one.
    const other = await ask(cookies["member-maya"], "Zyxwv quasar plimsoll?", "payload-insufficient-3");
    const [mayaTurn] = await turnsOf(other.conversationId, cookies["member-maya"]);
    expect(mayaTurn.feedback).toBeNull();
    expect(mayaTurn.documentRequested).toBe(false);
  });

  it("does not collapse the stored answer type", async () => {
    const turn = await seedGroundedAnswer({ owner: "member-maya", requestId: "payload-types", generationId });
    await env.OPERATIONS_DB.prepare(`UPDATE messages SET answer_type = 'unavailable' WHERE id = ?`)
      .bind(turn.assistantMessageId)
      .run();
    const [shown] = await turnsOf(turn.conversationId, cookies["member-maya"]);
    expect(shown.answerType).toBe("unavailable");
    expect(shown.answer!.structuredAnswer.answerType).toBe("insufficient_evidence");
  });

  it("a failed turn keeps its id so the client can retry it, and has no metrics", async () => {
    const turn = await seedGroundedAnswer({ owner: "member-maya", requestId: "payload-failed", generationId });
    await env.OPERATIONS_DB.prepare(
      `UPDATE messages SET status = 'failed', error_code = 'CANCELLED', answer_type = NULL WHERE id = ?`,
    )
      .bind(turn.assistantMessageId)
      .run();
    const [shown] = await turnsOf(turn.conversationId, cookies["member-maya"]);
    expect(shown.id).toBe(turn.assistantMessageId);
    expect(shown.answer).toBeNull();
    expect(shown.cancelled).toBe(true);
  });
});
