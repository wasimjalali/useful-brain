import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { call, seedChatCorpus } from "./chat-helpers";
import { seedPersonas, seedPrincipals, type PersonaId } from "./seed";

let cookies: Record<PersonaId, string>;

beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
  await seedChatCorpus();
});

const rows = async (principal: string) =>
  (
    await env.OPERATIONS_DB.prepare(
      `SELECT question_normalized, message_id FROM document_requests WHERE principal_id = ? ORDER BY created_at`,
    )
      .bind(principal)
      .all<{ question_normalized: string; message_id: string | null }>()
  ).results;

describe("POST /document-requests", () => {
  it("requires a session", async () => {
    expect((await call("/document-requests", undefined, { json: { question: "remote work stipend" } })).status).toBe(401);
  });

  it("rejects a missing, non-string, too short and too long question before storage", async () => {
    for (const json of [{}, { question: 5 }, { question: null }, { question: "  a  " }, { question: "ab" }, { question: "x".repeat(301) }]) {
      const res = await call("/document-requests", cookies["member-maya"], { json });
      expect(res.status, JSON.stringify(json)).toBe(400);
    }
    expect((await call("/document-requests", cookies["member-maya"], { rawBody: "{nope" })).status).toBe(400);
    expect(await rows("member-maya")).toEqual([]);
  });

  it("stores a normalized question with no message id and is idempotent per principal", async () => {
    const asked = "  Remote   WORK ｓtipend ?  ";
    const res = await call("/document-requests", cookies["member-maya"], { json: { question: asked } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requested: true });
    const expected = asked.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
    expect(await rows("member-maya")).toEqual([{ question_normalized: expected, message_id: null }]);

    const again = await call("/document-requests", cookies["member-maya"], { json: { question: "remote work stipend ?" } });
    expect(again.status).toBe(200);
    expect(await rows("member-maya")).toHaveLength(1);

    const other = await call("/document-requests", cookies["member-priya"], { json: { question: asked } });
    expect(other.status).toBe(200);
    expect(await rows("member-priya")).toHaveLength(1);
  });

  it("accepts exactly 300 characters", async () => {
    const res = await call("/document-requests", cookies["member-priya"], { json: { question: "q".repeat(300) } });
    expect(res.status).toBe(200);
  });

  it("ignores client-supplied normalized text and message ids", async () => {
    const res = await call("/document-requests", cookies["member-maya"], {
      json: { question: "travel booking rules", questionNormalized: "evil", messageId: "m-1" },
    });
    expect(res.status).toBe(200);
    const stored = (await rows("member-maya")).map((r) => r.question_normalized);
    expect(stored).toContain("travel booking rules");
    expect(stored).not.toContain("evil");
  });
});
