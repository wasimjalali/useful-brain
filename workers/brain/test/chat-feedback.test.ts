import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { call, seedChatCorpus, seedGroundedAnswer } from "./chat-helpers";
import { seedPersonas, seedPrincipals, type PersonaId } from "./seed";

let cookies: Record<PersonaId, string>;

beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
  await seedChatCorpus();
});

type Turn = { conversationId: string; assistantMessageId: string; structuredAnswer: { answerType: string } };

async function ask(cookie: string, question: string, requestId: string): Promise<Turn> {
  const res = await call("/turns", cookie, { json: { question, requestId } });
  expect(res.status).toBe(200);
  return (await res.json()) as Turn;
}

const GROUNDED_Q = "How does leave work at Northwind?";
const NOTHING_Q = "Zyxwv quasar plimsoll?";

async function feedbackRows(messageId: string) {
  return (
    await env.OPERATIONS_DB.prepare(`SELECT principal_id, value FROM message_feedback WHERE message_id = ?`)
      .bind(messageId)
      .all<{ principal_id: string; value: string }>()
  ).results;
}

describe("POST/DELETE /messages/:id/feedback", () => {
  it("requires a session", async () => {
    expect((await call("/messages/m-x/feedback", undefined, { json: { value: "up" } })).status).toBe(401);
    expect((await call("/messages/m-x/feedback", undefined, { method: "DELETE" })).status).toBe(401);
  });

  it("rejects a value outside up/down and a malformed body before touching storage", async () => {
    const turn = await ask(cookies["member-maya"], GROUNDED_Q, "fb-val-1");
    for (const json of [{ value: "sideways" }, { value: "UP" }, { value: 1 }, {}, { value: null }]) {
      const res = await call(`/messages/${turn.assistantMessageId}/feedback`, cookies["member-maya"], { json });
      expect(res.status).toBe(400);
    }
    expect((await call(`/messages/${turn.assistantMessageId}/feedback`, cookies["member-maya"], { rawBody: "{nope" })).status).toBe(400);
    expect(await feedbackRows(turn.assistantMessageId)).toEqual([]);
  });

  it("upserts one row per (message, principal), switches value and deletes idempotently", async () => {
    const turn = await ask(cookies["member-maya"], GROUNDED_Q, "fb-up-1");
    const url = `/messages/${turn.assistantMessageId}/feedback`;
    let res = await call(url, cookies["member-maya"], { json: { value: "up" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: "up" });
    res = await call(url, cookies["member-maya"], { json: { value: "up" } });
    expect(res.status).toBe(200);
    expect(await feedbackRows(turn.assistantMessageId)).toEqual([{ principal_id: "member-maya", value: "up" }]);
    res = await call(url, cookies["member-maya"], { json: { value: "down" } });
    expect(await res.json()).toEqual({ value: "down" });
    expect(await feedbackRows(turn.assistantMessageId)).toEqual([{ principal_id: "member-maya", value: "down" }]);

    res = await call(url, cookies["member-maya"], { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await feedbackRows(turn.assistantMessageId)).toEqual([]);
    expect((await call(url, cookies["member-maya"], { method: "DELETE" })).status).toBe(200);
  });

  it("is 404 on another member's message, an unknown id, a user message and a failed message, with the same body", async () => {
    const turn = await ask(cookies["member-maya"], GROUNDED_Q, "fb-404-1");
    const userMessage = (
      await env.OPERATIONS_DB.prepare(
        `SELECT id FROM messages WHERE conversation_id = ? AND role = 'user'`,
      )
        .bind(turn.conversationId)
        .first<{ id: string }>()
    )!.id;
    const failedId = "m-failed-fb";
    await env.OPERATIONS_DB.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, status, error_code, parent_user_message_id, created_at, updated_at)
       VALUES (?, ?, 'assistant', '', 'failed', 'CANCELLED', ?, 9, 9)`,
    )
      .bind(failedId, turn.conversationId, userMessage)
      .run();

    const bodies: unknown[] = [];
    for (const [id, cookie] of [
      [turn.assistantMessageId, cookies["member-priya"]],
      ["m-does-not-exist", cookies["member-maya"]],
      [userMessage, cookies["member-maya"]],
      [failedId, cookies["member-maya"]],
    ] as const) {
      for (const init of [{ json: { value: "up" } }, { method: "DELETE" }]) {
        const res = await call(`/messages/${id}/feedback`, cookie, init);
        expect(res.status).toBe(404);
        const body = (await res.json()) as { code: string; message: string };
        bodies.push({ code: body.code, message: body.message });
      }
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(await feedbackRows(turn.assistantMessageId)).toEqual([]);
  });

  it("is removed with the conversation", async () => {
    const turn = await ask(cookies["member-maya"], GROUNDED_Q, "fb-cascade-1");
    await call(`/messages/${turn.assistantMessageId}/feedback`, cookies["member-maya"], { json: { value: "down" } });
    expect(await feedbackRows(turn.assistantMessageId)).toHaveLength(1);
    const del = await call(`/conversations/${turn.conversationId}`, cookies["member-maya"], { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await feedbackRows(turn.assistantMessageId)).toEqual([]);
  });
});

describe("POST /messages/:id/request-document", () => {
  const rows = async (principal: string) =>
    (
      await env.OPERATIONS_DB.prepare(
        `SELECT question_normalized, message_id FROM document_requests WHERE principal_id = ? ORDER BY created_at`,
      )
        .bind(principal)
        .all<{ question_normalized: string; message_id: string | null }>()
    ).results;

  it("requires a session", async () => {
    expect((await call("/messages/m-x/request-document", undefined, { method: "POST" })).status).toBe(401);
  });

  it("only works on an insufficient-evidence answer: a grounded one is 400", async () => {
    const grounded = await seedGroundedAnswer({ owner: "member-maya", requestId: "dr-grounded-1" });
    const res = await call(`/messages/${grounded.assistantMessageId}/request-document`, cookies["member-maya"], {
      method: "POST",
    });
    expect(res.status).toBe(400);
    expect(await rows("member-maya")).toEqual([]);
  });

  it("is 404 on another member's message and on an unknown id, with the same body", async () => {
    const turn = await ask(cookies["member-maya"], NOTHING_Q, "dr-foreign-1");
    const foreign = await call(`/messages/${turn.assistantMessageId}/request-document`, cookies["member-priya"], { method: "POST" });
    const unknown = await call(`/messages/m-nope/request-document`, cookies["member-priya"], { method: "POST" });
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    const strip = async (r: Response) => {
      const { code, message } = (await r.json()) as { code: string; message: string };
      return { code, message };
    };
    expect(await strip(foreign)).toEqual(await strip(unknown));
    expect(await rows("member-priya")).toEqual([]);
  });

  it("derives the question server-side and ignores client text; repeats are idempotent per principal", async () => {
    const question = `  ZYXWV   ｑuasar   PLIMSOLL ${"zyxwv ".repeat(80)}?  `;
    const first = await ask(cookies["member-maya"], question, "dr-derive-1");
    expect(first.structuredAnswer.answerType).toBe("insufficient_evidence");
    const url = `/messages/${first.assistantMessageId}/request-document`;
    const res = await call(url, cookies["member-maya"], { json: { question: "client supplied text", questionNormalized: "evil" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requested: true });

    const stored = await rows("member-maya");
    expect(stored).toHaveLength(1);
    const expected = question.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 300).trim();
    expect(stored[0].question_normalized).toBe(expected);
    expect(stored[0].question_normalized.length).toBeLessThanOrEqual(300);
    expect(stored[0].question_normalized).not.toContain("client supplied");

    expect(await (await call(url, cookies["member-maya"], { method: "POST" })).json()).toEqual({ requested: true });
    const again = await ask(cookies["member-maya"], question.toUpperCase(), "dr-derive-2");
    await call(`/messages/${again.assistantMessageId}/request-document`, cookies["member-maya"], { method: "POST" });
    expect(await rows("member-maya")).toHaveLength(1);

    const other = await ask(cookies["member-priya"], question, "dr-derive-3");
    await call(`/messages/${other.assistantMessageId}/request-document`, cookies["member-priya"], { method: "POST" });
    expect(await rows("member-priya")).toHaveLength(1);
  });

  it("keeps the request, detached from the message, when its conversation is deleted", async () => {
    const turn = await ask(cookies["member-maya"], "Qwxyz plimsoll vortex nonsense?", "dr-keep-1");
    const res = await call(`/messages/${turn.assistantMessageId}/request-document`, cookies["member-maya"], { method: "POST" });
    expect(res.status).toBe(200);
    const before = await rows("member-maya");
    expect(before.filter((r) => r.message_id === turn.assistantMessageId)).toHaveLength(1);
    const del = await call(`/conversations/${turn.conversationId}`, cookies["member-maya"], { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = await rows("member-maya");
    expect(after).toHaveLength(before.length);
    expect(after.some((r) => r.message_id === turn.assistantMessageId)).toBe(false);
    expect(after.find((r) => r.question_normalized === "qwxyz plimsoll vortex nonsense?")).toMatchObject({ message_id: null });
  });
});
