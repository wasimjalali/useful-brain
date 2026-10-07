import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { createPendingTurn, failTurn } from "../../../src/lib/store/conversations";
import { call, seedChatCorpus } from "./chat-helpers";
import { seedPersonas, seedPrincipals, type PersonaId } from "./seed";

let cookies: Record<PersonaId, string>;

beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
  await seedChatCorpus();
});

const QUESTION = "How does leave work at Northwind?";

async function failedTurn(owner: string, requestId: string, errorCode = "CANCELLED") {
  const pending = await createPendingTurn(env.OPERATIONS_DB, {
    ownerPrincipalId: owner,
    requestId,
    question: QUESTION,
    now: 1_000,
  });
  await failTurn(env.OPERATIONS_DB, {
    assistantMessageId: pending.assistantMessageId,
    ownerPrincipalId: owner,
    errorCode,
    now: 1_001,
  });
  return pending;
}

const messageRows = async (conversationId: string) =>
  (
    await env.OPERATIONS_DB.prepare(
      `SELECT id, role, status, content, parent_user_message_id FROM messages WHERE conversation_id = ? ORDER BY created_at, id`,
    )
      .bind(conversationId)
      .all<{ id: string; role: string; status: string; content: string; parent_user_message_id: string | null }>()
  ).results;

describe("POST /turns { retryOfMessageId }", () => {
  it("is 404 for another member's failed message and an unknown id, and creates nothing", async () => {
    const failed = await failedTurn("member-maya", "retry-src-foreign");
    const before = await messageRows(failed.conversationId);
    for (const id of [failed.assistantMessageId, "m-no-such-message"]) {
      const res = await call("/turns", cookies["member-priya"], {
        json: { retryOfMessageId: id, requestId: `retry-foreign-${id}` },
      });
      expect(res.status).toBe(404);
    }
    expect(await messageRows(failed.conversationId)).toEqual(before);
  });

  it("rejects retrying an answer that did not fail (completed or pending) with 400", async () => {
    const done = await call("/turns", cookies["member-maya"], { json: { question: QUESTION, requestId: "retry-src-done" } });
    const doneBody = (await done.json()) as { assistantMessageId: string };
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "member-maya",
      requestId: "retry-src-pending",
      question: QUESTION,
      now: 5_000,
    });
    for (const id of [doneBody.assistantMessageId, pending.assistantMessageId]) {
      const res = await call("/turns", cookies["member-maya"], {
        json: { retryOfMessageId: id, requestId: `retry-nonfailed-${id}` },
      });
      expect(res.status).toBe(400);
    }
  });

  it("rejects a malformed retry id", async () => {
    const res = await call("/turns", cookies["member-maya"], {
      json: { retryOfMessageId: { $ne: 1 }, requestId: "retry-malformed" },
    });
    expect(res.status).toBe(400);
  });

  it("re-runs the saved user message, ignores client text and conversation id, and adds no user row", async () => {
    const failed = await failedTurn("member-maya", "retry-src-ok");
    const userMessage = (await messageRows(failed.conversationId)).find((m) => m.role === "user")!;
    const res = await call("/turns", cookies["member-maya"], {
      json: {
        retryOfMessageId: failed.assistantMessageId,
        requestId: "retry-ok-1",
        question: "client resent different text",
        conversationId: "c-someone-else",
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      question: string;
      conversationId: string;
      assistantMessageId: string;
    };
    expect(body.question).toBe(QUESTION);
    expect(body.conversationId).toBe(failed.conversationId);
    expect(body.assistantMessageId).not.toBe(failed.assistantMessageId);

    const rows = await messageRows(failed.conversationId);
    expect(rows.filter((m) => m.role === "user")).toHaveLength(1);
    expect(rows.filter((m) => m.role === "assistant").map((m) => m.status).sort()).toEqual(["completed", "failed"]);
    const retried = rows.find((m) => m.id === body.assistantMessageId)!;
    expect(retried.parent_user_message_id).toBe(userMessage.id);
    expect(rows.some((m) => m.content === "client resent different text")).toBe(false);
  });

  it("is idempotent per original message and request id: the same retry replays", async () => {
    const failed = await failedTurn("member-maya", "retry-src-idem");
    const send = () =>
      call("/turns", cookies["member-maya"], {
        json: { retryOfMessageId: failed.assistantMessageId, requestId: "retry-idem-1" },
      });
    const first = (await (await send()).json()) as { assistantMessageId: string };
    const second = await send();
    expect(second.status).toBe(200);
    expect(((await second.json()) as { assistantMessageId: string }).assistantMessageId).toBe(first.assistantMessageId);
    const rows = await messageRows(failed.conversationId);
    expect(rows.filter((m) => m.role === "assistant")).toHaveLength(2);
    expect(rows.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("the conversation view shows the retried answer once, not the failed attempt beside it", async () => {
    const failed = await failedTurn("member-maya", "retry-src-view");
    await call("/turns", cookies["member-maya"], {
      json: { retryOfMessageId: failed.assistantMessageId, requestId: "retry-view-1" },
    });
    const conversation = (await (await call(`/conversations/${failed.conversationId}`, cookies["member-maya"])).json()) as {
      turns: Array<{ question: string; answer: unknown; error: string | null }>;
    };
    expect(conversation.turns).toHaveLength(1);
    expect(conversation.turns[0].answer).not.toBeNull();
  });
});
