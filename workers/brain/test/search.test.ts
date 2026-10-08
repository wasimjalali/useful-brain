import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import type { SearchResponse } from "../../../src/lib/contracts/library";
import worker from "../src";
import { seedCorpus, seedPersonas, seedPrincipals, type PersonaId } from "./seed";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const sessionEnv = { ...env, IDENTITY_MODE: "session", LOOPBACK_RUNTIME: "false", LOOPBACK_SUBJECT: "" };

async function call(path: string, cookie?: string): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new IncomingRequest(`https://brain.internal${path}`, { headers: cookie ? { cookie } : {} }),
    sessionEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

async function search(persona: PersonaId, q: string): Promise<SearchResponse> {
  const response = await call(`/search?q=${encodeURIComponent(q)}`, cookies[persona]);
  expect(response.status, q).toBe(200);
  return (await response.json()) as SearchResponse;
}

let cookies: Record<PersonaId, string>;
let generationId: string;

async function seedChat(id: string, owner: string, title: string, message: string, updatedAt: number) {
  await env.OPERATIONS_DB.batch([
    env.OPERATIONS_DB.prepare(
      `INSERT INTO conversations (id, owner_principal_id, title, created_at, updated_at) VALUES (?, ?, ?, 1, ?)`,
    ).bind(id, owner, title, updatedAt),
    env.OPERATIONS_DB.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, status, created_at, updated_at)
       VALUES (?, ?, 'user', ?, 'completed', 1, 1)`,
    ).bind(`${id}-m`, id, message),
  ]);
}

beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
  generationId = (await seedCorpus()).generationId;
  await seedChat("c-maya-1", "member-maya", "Quarterly roadmap", "What is in the roadmap?", 10);
  await seedChat("c-priya-1", "member-priya", "Quarterly roadmap", "roadmap secrets of priya", 11);
  await seedChat("c-maya-pct", "member-maya", "Discounts", "We offered 100% off today", 12);
  await seedChat("c-maya-x", "member-maya", "Other", "We offered 100x speed", 13);
  for (let i = 0; i < 7; i += 1) {
    await seedChat(`c-maya-alpha-${i}`, "member-maya", `Alpha ${i}`, "alpha", 20 + i);
  }
});

describe("GET /search validation", () => {
  it("needs a session", async () => {
    expect((await call("/search?q=runbook")).status).toBe(401);
  });

  it("rejects a missing, too-short or too-long query with 400", async () => {
    for (const q of ["", " a ", "x".repeat(201)]) {
      expect((await call(`/search?q=${encodeURIComponent(q)}`, cookies["member-maya"])).status, q).toBe(400);
    }
    expect((await call("/search", cookies["member-maya"])).status).toBe(400);
  });
});

describe("document search", () => {
  it("finds a readable document by title with server-computed match ranges", async () => {
    const result = await search("member-maya", "runbook");
    const hit = result.documents.find((d) => d.id === "doc-eng-runbook")!;
    expect(hit.title).toBe("Incident Runbook");
    expect(hit.department).toBe("engineering");
    expect(hit.titleMatches).toEqual([[9, 16]]);
    expect(hit.snippet).toMatch(/ · /);
  });

  it("finds a document by section heading with a Section · text snippet from the body", async () => {
    const result = await search("member-maya", "postmortem");
    const hit = result.documents.find((d) => d.id === "doc-eng-runbook")!;
    expect(hit.snippet!.startsWith("Postmortem · ")).toBe(true);
    expect(hit.snippet).toContain("Incident Runbook Postmortem note 2-0");
  });

  it("never returns another department's, a role-gated or a private document", async () => {
    expect((await search("member-priya", "runbook")).documents).toEqual([]);
    expect((await search("member-priya", "rollback")).documents).toEqual([]);
    expect((await search("member-maya", "vendor")).documents).toEqual([]);
    expect((await search("member-maya", "compensation")).documents).toEqual([]);
    expect((await search("member-jordan", "budget")).documents).toEqual([]);
    expect((await search("member-priya", "private notes")).documents).toEqual([]);
    expect((await search("member-jordan", "notes")).documents).toEqual([]);
    expect((await search("member-maya", "private notes")).documents.map((d) => d.id)).toEqual(["doc-private-maya"]);
    expect((await search("member-jordan", "vendor")).documents.map((d) => d.id)).toEqual(["doc-ops-vendors"]);
  });

  it("never returns a snippet that carries text from an unreadable document", async () => {
    for (const q of ["runbook", "rollback", "paging", "synthetic"]) {
      const text = JSON.stringify(await search("member-priya", q));
      expect(text).not.toContain("Incident Runbook");
      expect(text).not.toContain("Rollback");
    }
  });

  it("does not list draft generation documents", async () => {
    await env.CORPUS_DB.batch([
      env.CORPUS_DB.prepare(
        `INSERT INTO corpus_generations (id, state, created_at, updated_at) VALUES ('gen-draft-s', 'draft', 1, 1)`,
      ),
      env.CORPUS_DB.prepare(
        `INSERT INTO document_catalog (document_id, generation_id, title, access_scope, chunk_count, file_name, updated_at)
         VALUES ('doc-draft-s', 'gen-draft-s', 'Zebra Draft', 'public', 1, 'z.md', 1)`,
      ),
    ]);
    expect((await search("member-maya", "zebra")).documents).toEqual([]);
  });

  it("survives FTS syntax, quotes and operators without an error or a leak", async () => {
    const hostile = [
      '"',
      'runbook" OR "x',
      "runbook OR NEAR(",
      "* ** ***",
      "title:vendor",
      "-runbook",
      "(runbook",
      "runbook AND NOT paging",
      "a OR b",
      "':;{}[]",
    ];
    for (const q of hostile) {
      const result = await search("member-priya", q.length < 2 ? `${q}${q}` : q);
      expect(result.documents.map((d) => d.id), q).not.toContain("doc-eng-runbook");
      expect(result.documents.map((d) => d.id), q).not.toContain("doc-private-maya");
    }
    expect((await search("member-maya", '"runbook"')).documents.map((d) => d.id)).toContain("doc-eng-runbook");
  });
});

describe("chat search", () => {
  it("returns only the caller's own chats", async () => {
    const maya = await search("member-maya", "roadmap");
    expect(maya.chats.map((c) => c.id)).toEqual(["c-maya-1"]);
    const priya = await search("member-priya", "roadmap");
    expect(priya.chats.map((c) => c.id)).toEqual(["c-priya-1"]);
    expect(JSON.stringify(maya)).not.toContain("priya");
    expect((await search("member-jordan", "roadmap")).chats).toEqual([]);
  });

  it("matches message text and gives a snippet and title ranges", async () => {
    const maya = await search("member-maya", "roadmap");
    expect(maya.chats[0].titleMatches).toEqual([[10, 17]]);
    expect(maya.chats[0].snippet).toContain("roadmap");
  });

  it("escapes LIKE wildcards", async () => {
    expect((await search("member-maya", "100%")).chats.map((c) => c.id)).toEqual(["c-maya-pct"]);
    expect((await search("member-maya", "%%")).chats).toEqual([]);
    expect((await search("member-maya", "__")).chats).toEqual([]);
  });

  it("caps chats and documents at five each", async () => {
    const result = await search("member-maya", "alpha");
    expect(result.chats).toHaveLength(5);
  });
});

async function insertCatalogDoc(
  id: string,
  title: string,
  access: { scope: string; roles?: string[] },
  readable: boolean,
) {
  const statements = [
    env.CORPUS_DB.prepare(
      `INSERT INTO document_catalog (document_id, generation_id, title, access_scope, allowed_roles, chunk_count, file_name, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 'x.md', 1)`,
    ).bind(id, generationId, title, access.scope, JSON.stringify(access.roles ?? [])),
  ];
  if (readable) {
    statements.push(
      env.CORPUS_DB.prepare(
        `INSERT INTO chunks (chunk_id, document_id, document_version_id, generation_id, heading, chunk_index, content,
           start_offset, end_offset, content_digest, vector_id, acl_group, access_scope, allowed_roles, allowed_departments, metadata, created_at)
         VALUES (?, ?, 'v', ?, 'H', 0, 'text', 0, 4, 'd', ?, ?, ?, ?, '[]', '{}', 1)`,
      ).bind(`chunk-${id}`, id, generationId, `vec-${id}`, "a".repeat(32), access.scope, JSON.stringify(access.roles ?? [])),
      env.CORPUS_DB.prepare(
        `INSERT INTO document_bodies (document_id, generation_id, body, reconstructed) VALUES (?, ?, ?, 0)`,
      ).bind(id, generationId, `# ${title}\n\n## Section\n\nBody text.`),
    );
  }
  await env.CORPUS_DB.batch(statements);
}

describe("document ranking does not depend on documents the caller cannot read", () => {
  it("keeps a member's result order when hidden documents change the term statistics", async () => {
    await insertCatalogDoc("doc-rank-1", "qalpha qalpha qbeta", { scope: "public" }, true);
    await insertCatalogDoc("doc-rank-2", "qalpha qbeta qbeta", { scope: "public" }, true);
    const order = async () => (await search("member-maya", "qalpha qbeta")).documents.map((d) => d.id);
    const baseline = await order();
    expect(baseline).toEqual(["doc-rank-1", "doc-rank-2"]);
    for (let i = 0; i < 8; i += 1) {
      await insertCatalogDoc(`doc-hidden-a-${i}`, "qalpha qalpha qalpha", { scope: "role", roles: ["nobody"] }, false);
    }
    expect(await order()).toEqual(baseline);
    for (let i = 0; i < 16; i += 1) {
      await insertCatalogDoc(`doc-hidden-b-${i}`, "qbeta qbeta qbeta", { scope: "role", roles: ["nobody"] }, false);
    }
    expect(await order()).toEqual(baseline);
  });

  it("lists a catalog row with no body in neither search nor the document route", async () => {
    await insertCatalogDoc("doc-nobody-body", "qgamma notes", { scope: "public" }, true);
    await env.CORPUS_DB.prepare(`DELETE FROM document_bodies WHERE document_id = 'doc-nobody-body'`).run();
    expect((await search("member-maya", "qgamma")).documents).toEqual([]);
  });
});
