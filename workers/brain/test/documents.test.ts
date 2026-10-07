import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import type { DocumentResponse } from "../../../src/lib/contracts/library";
import worker from "../src";
import { seedCorpus, seedPersonas, seedPrincipals, type PersonaId } from "./seed";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const sessionEnv = { ...env, IDENTITY_MODE: "session", LOOPBACK_RUNTIME: "false", LOOPBACK_SUBJECT: "" };

async function call(path: string, cookie?: string): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new IncomingRequest(`https://brain.internal${path}`, {
      headers: { ...(cookie ? { cookie } : {}), "x-request-id": "11111111-1111-4111-8111-111111111111" },
    }),
    sessionEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

let cookies: Record<PersonaId, string>;
let generationId: string;

beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
  generationId = (await seedCorpus()).generationId;
});

describe("GET /documents/:id access", () => {
  it("needs a session", async () => {
    expect((await call("/documents/doc-public-handbook")).status).toBe(401);
  });

  it("answers a byte-identical 404 for unreadable, unknown, malformed and cross-department ids", async () => {
    const probes: Array<[string, PersonaId]> = [
      ["doc-eng-runbook", "member-priya"],
      ["doc-private-maya", "member-priya"],
      ["doc-private-maya", "member-jordan"],
      ["doc-finance-policy", "member-maya"],
      ["doc-manager-comp", "member-jordan"],
      ["doc-ops-vendors", "member-maya"],
      ["doc-does-not-exist", "member-maya"],
      ["bad%20id!", "member-maya"],
    ];
    const bodies = new Set<string>();
    for (const [id, persona] of probes) {
      const response = await call(`/documents/${id}`, cookies[persona]);
      expect(response.status, `${id} as ${persona}`).toBe(404);
      bodies.add(await response.text());
    }
    expect(bodies.size).toBe(1);
  });

  it("never serves a draft-only or non-active generation document", async () => {
    await env.CORPUS_DB.batch([
      env.CORPUS_DB.prepare(
        `INSERT INTO corpus_generations (id, state, created_at, updated_at) VALUES ('gen-draft-x', 'draft', 1, 1)`,
      ),
      env.CORPUS_DB.prepare(
        `INSERT INTO document_catalog (document_id, generation_id, title, access_scope, chunk_count, file_name, updated_at)
         VALUES ('doc-draft-only', 'gen-draft-x', 'Draft Only', 'public', 1, 'draft.md', 1)`,
      ),
      env.CORPUS_DB.prepare(
        `INSERT INTO document_bodies (document_id, generation_id, body, reconstructed) VALUES ('doc-draft-only', 'gen-draft-x', '# Draft Only\n\n## A\n\nSecret draft text.', 0)`,
      ),
    ]);
    const response = await call("/documents/doc-draft-only", cookies["member-maya"]);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Secret draft");
  });

  it("hides a document whose catalog row has no body", async () => {
    await env.CORPUS_DB.prepare(
      `DELETE FROM document_bodies WHERE generation_id = ? AND document_id = 'doc-support-playbook'`,
    ).bind(generationId).run();
    expect((await call("/documents/doc-support-playbook", cookies["member-priya"])).status).toBe(404);
    await env.CORPUS_DB.prepare(
      `INSERT INTO document_bodies (document_id, generation_id, body, reconstructed) VALUES ('doc-support-playbook', ?, '# Support Playbook\n\n## Escalation\n\nEscalate P0 tickets within ten minutes.', 0)`,
    ).bind(generationId).run();
    expect((await call("/documents/doc-support-playbook", cookies["member-priya"])).status).toBe(200);
  });
});

describe("GET /documents/:id content", () => {
  it("returns metadata, readers and body sections split by headings", async () => {
    const response = await call("/documents/doc-eng-runbook", cookies["member-maya"]);
    expect(response.status).toBe(200);
    const doc = (await response.json()) as DocumentResponse;
    expect(doc).toMatchObject({
      id: "doc-eng-runbook",
      title: "Incident Runbook",
      version: "2.0",
      effectiveDate: null,
      ownerDepartment: "engineering",
      readers: { kind: "departments", names: ["engineering"] },
    });
    expect(doc.sections.map((s) => s.heading)).toEqual(["Paging", "Rollback", "Postmortem"]);
    expect(doc.sections[1].text).toContain("Incident Runbook Rollback note 1-0 covers");
    expect(doc.sections[1].text).not.toContain("##");
    expect(doc.spans).toBeUndefined();
  });

  it("labels a private document without leaking the owner id", async () => {
    const response = await call("/documents/doc-private-maya", cookies["member-maya"]);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text).readers).toEqual({ kind: "private", names: [] });
    expect(text).not.toContain("member-maya");
  });

  it("rejects a document whose chunks disagree on access (mixed)", async () => {
    await env.CORPUS_DB.prepare(
      `UPDATE chunks SET access_scope = 'department', allowed_departments = '["hr"]'
       WHERE generation_id = ? AND document_id = 'doc-public-handbook' AND chunk_index = 1`,
    ).bind(generationId).run();
    const response = await call("/documents/doc-public-handbook", cookies["member-maya"]);
    expect(response.status).toBe(404);
    await env.CORPUS_DB.prepare(
      `UPDATE chunks SET access_scope = 'public', allowed_departments = '[]'
       WHERE generation_id = ? AND document_id = 'doc-public-handbook' AND chunk_index = 1`,
    ).bind(generationId).run();
    expect((await call("/documents/doc-public-handbook", cookies["member-maya"])).status).toBe(200);
  });
});

const SENTENCE = "Incident Runbook Rollback note 1-7 covers the synthetic procedure.";

async function seedMessage(input: {
  conversationId: string;
  messageId: string;
  owner: string;
  citedDocumentId: string | null;
  paragraphText: string;
}): Promise<void> {
  const chunk = await env.CORPUS_DB.prepare(
    `SELECT chunk_id FROM chunks WHERE generation_id = ? AND document_id = 'doc-eng-runbook' AND instr(content, ?) > 0 LIMIT 1`,
  ).bind(generationId, SENTENCE).first<{ chunk_id: string }>();
  expect(chunk).not.toBeNull();
  await env.OPERATIONS_DB.batch([
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO conversations (id, owner_principal_id, title, created_at, updated_at) VALUES (?, ?, 'Spans', 1, 1)`,
    ).bind(input.conversationId, input.owner),
    env.OPERATIONS_DB.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, status, answer_type, structured_paragraphs_json, corpus_generation_id, created_at, updated_at)
       VALUES (?, ?, 'assistant', 'answer', 'completed', 'grounded', ?, ?, 2, 2)`,
    ).bind(
      input.messageId,
      input.conversationId,
      JSON.stringify([{ text: input.paragraphText, citations: ["[1]"] }]),
      generationId,
    ),
    env.OPERATIONS_DB.prepare(
      `INSERT INTO evidence_snapshots (message_id, rank, score, chunk_id, source, section, text, token_estimate, citation_label, document_id, generation_id)
       VALUES (?, 1, 1, ?, 'Incident Runbook', 'Rollback', 'x', 1, '[1]', ?, ?)`,
    ).bind(input.messageId, chunk!.chunk_id, input.citedDocumentId, generationId),
  ]);
}

describe("GET /documents/:id?message= spans", () => {
  const paragraph = `The runbook says: ${SENTENCE}`;

  it("returns spans that locate the relied-on sentence inside its section", async () => {
    await seedMessage({
      conversationId: "conv-maya-spans",
      messageId: "msg-maya-spans",
      owner: "member-maya",
      citedDocumentId: "doc-eng-runbook",
      paragraphText: paragraph,
    });
    const response = await call("/documents/doc-eng-runbook?message=msg-maya-spans", cookies["member-maya"]);
    expect(response.status).toBe(200);
    const doc = (await response.json()) as DocumentResponse;
    expect(doc.spans).toHaveLength(1);
    const span = doc.spans![0];
    expect(doc.sections[span.section].heading).toBe("Rollback");
    expect(doc.sections[span.section].text.slice(span.start, span.end)).toBe(SENTENCE);
    expect(span).toMatchObject({ citation: "[1]", active: true });
  });

  it("answers 404 for a message the caller does not own, with the same body as any other 404", async () => {
    const other = await call("/documents/doc-public-handbook?message=msg-maya-spans", cookies["member-priya"]);
    const unknown = await call("/documents/doc-public-handbook?message=msg-nope", cookies["member-priya"]);
    expect(other.status).toBe(404);
    expect(await other.text()).toBe(await unknown.text());
  });

  it("returns no spans for an own message that cited a different document", async () => {
    await seedMessage({
      conversationId: "conv-maya-other",
      messageId: "msg-maya-other",
      owner: "member-maya",
      citedDocumentId: "doc-public-handbook",
      paragraphText: paragraph,
    });
    const response = await call("/documents/doc-eng-runbook?message=msg-maya-other", cookies["member-maya"]);
    expect(response.status).toBe(200);
    expect(((await response.json()) as DocumentResponse).spans).toBeUndefined();
  });

  it("returns no spans when the body is reconstructed", async () => {
    await env.CORPUS_DB.prepare(
      `UPDATE document_bodies SET reconstructed = 1 WHERE generation_id = ? AND document_id = 'doc-eng-runbook'`,
    ).bind(generationId).run();
    const response = await call("/documents/doc-eng-runbook?message=msg-maya-spans", cookies["member-maya"]);
    expect(response.status).toBe(200);
    expect(((await response.json()) as DocumentResponse).spans).toBeUndefined();
  });
});
