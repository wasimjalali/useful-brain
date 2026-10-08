import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { CURATED_SUGGESTIONS } from "../../../src/lib/store/suggestions";
import { loadKnowledgeInventory } from "../../../src/lib/store/knowledge-inventory";
import { call, seedChatCorpus } from "./chat-helpers";
import { seedPersonas, seedPrincipals, seedSessionUser, type PersonaId } from "./seed";

let cookies: Record<PersonaId, string>;

beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
  await seedChatCorpus();
});

type Suggestion = { text: string; department: string };

async function suggestionsFor(cookie: string): Promise<Suggestion[]> {
  const res = await call("/suggestions", cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { suggestions: Suggestion[] }).suggestions;
}

describe("GET /suggestions", () => {
  it("requires a session", async () => {
    expect((await call("/suggestions")).status).toBe(401);
  });

  it("has at least four curated questions, each tied to a Northwind document id", () => {
    expect(CURATED_SUGGESTIONS.length).toBeGreaterThanOrEqual(8);
    for (const item of CURATED_SUGGESTIONS) {
      expect(item.documentId).toMatch(/^nw_/);
      expect(item.text.length).toBeGreaterThan(10);
    }
    expect(CURATED_SUGGESTIONS.slice(0, 4).map((s) => s.text)).toEqual([
      "How much parental leave do I get, and when am I eligible?",
      "What is the first-response target for a P1 ticket?",
      "How long are system logs kept?",
      "Can I keep my laptop when I leave Northwind?",
    ]);
  });

  it("returns up to four {text, department} rows and nothing else", async () => {
    const items = await suggestionsFor(cookies["member-maya"]);
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(4);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(["department", "text"]);
    }
  });

  for (const persona of ["member-maya", "member-priya", "member-jordan"] as const) {
    it(`${persona}: every suggestion targets a document that persona can read`, async () => {
      const items = await suggestionsFor(cookies[persona]);
      const whoami = (await (await call("/whoami", cookies[persona])).json()) as {
        id: string;
        roles: string[];
        departments: string[];
      };
      const readable = new Set(
        (
          await loadKnowledgeInventory(env.CORPUS_DB, "keyword", {
            userId: whoami.id,
            roles: whoami.roles,
            departments: whoami.departments,
          })
        ).documents.map((d) => d.id),
      );
      for (const item of items) {
        const curated = CURATED_SUGGESTIONS.find((c) => c.text === item.text)!;
        expect(readable.has(curated.documentId)).toBe(true);
      }
    });
  }

  it("leaves out a department-only target for someone outside that department", async () => {
    const maya = (await suggestionsFor(cookies["member-maya"])).map((s) => s.text);
    const priya = (await suggestionsFor(cookies["member-priya"])).map((s) => s.text);
    const logs = "How long are system logs kept?";
    expect(maya).toContain(logs);
    expect(priya).not.toContain(logs);
    expect(priya.length).toBe(4);
  });

  it("a member with no roles or departments only sees public targets", async () => {
    const cookie = await seedSessionUser({
      id: "member-suggest-nobody",
      email: "suggest.nobody@northwind.example",
      name: "Nobody",
      roles: [],
      departments: [],
    });
    const texts = (await suggestionsFor(cookie)).map((s) => s.text);
    expect(texts).not.toContain("How long are system logs kept?");
    expect(texts).not.toContain("Can I keep my laptop when I leave Northwind?");
    expect(texts).toContain("How much parental leave do I get, and when am I eligible?");
  });

  it("returns an empty list when the target documents are not in the active generation", async () => {
    await env.CORPUS_DB.prepare(`DELETE FROM document_catalog WHERE document_id LIKE 'nw_%'`).run();
    expect(await suggestionsFor(cookies["member-maya"])).toEqual([]);
  });
});
