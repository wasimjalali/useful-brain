import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import type { LibraryResponse } from "../../../src/lib/contracts/library";
import { aclFilterFor, canAccessChunk } from "../../../src/lib/acl/access";
import { WorkerNotFoundError } from "../../../src/lib/cf/worker-errors";
import { resolveScopedDocument } from "../../../src/lib/store/library-queries";
import worker from "../src";
import {
  CORPUS_DOCUMENTS,
  EXPECTED_READABLE,
  seedCorpus,
  seedPersonas,
  seedPrincipals,
  type PersonaId,
} from "./seed";

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

async function library(persona: PersonaId): Promise<LibraryResponse> {
  const response = await call("/library", cookies[persona]);
  expect(response.status).toBe(200);
  return (await response.json()) as LibraryResponse;
}

let cookies: Record<PersonaId, string>;
let generationId: string;

const PRINCIPALS: Record<PersonaId, { userId: string; roles: string[]; departments: string[] }> = {
  "member-maya": { userId: "member-maya", roles: ["standard"], departments: ["engineering"] },
  "member-priya": { userId: "member-priya", roles: ["standard"], departments: ["support"] },
  "member-jordan": { userId: "member-jordan", roles: ["admin"], departments: ["operations"] },
};

beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
  generationId = (await seedCorpus()).generationId;
});

describe("GET /library", () => {
  it("needs a session", async () => {
    expect((await call("/library")).status).toBe(401);
  });

  it("lists exactly what the ACL oracle allows, for every persona (admin gets nothing extra)", async () => {
    for (const persona of Object.keys(PRINCIPALS) as PersonaId[]) {
      const principal = PRINCIPALS[persona];
      const oracle = CORPUS_DOCUMENTS.filter((doc) =>
        canAccessChunk(
          { ...principal, roles: aclFilterFor(principal).roles },
          {
            accessScope: doc.accessScope,
            allowedRoles: doc.allowedRoles,
            allowedDepartments: doc.allowedDepartments,
            metadata: doc.metadata,
          },
        ).allowed,
      ).map((doc) => doc.documentId);
      const listed = (await library(persona)).documents.map((doc) => doc.id).sort();
      expect(listed, persona).toEqual([...oracle].sort());
      expect(listed).toHaveLength(EXPECTED_READABLE[persona]);
    }
  });

  it("returns title, department, readers and headings but no body text", async () => {
    const response = await call("/library", cookies["member-maya"]);
    const text = await response.text();
    const docs = (JSON.parse(text) as LibraryResponse).documents;
    const runbook = docs.find((doc) => doc.id === "doc-eng-runbook")!;
    expect(runbook).toEqual({
      id: "doc-eng-runbook",
      title: "Incident Runbook",
      department: "engineering",
      readers: { kind: "departments", names: ["engineering"] },
      headings: ["Paging", "Rollback", "Postmortem"],
    });
    expect(docs.find((doc) => doc.id === "doc-public-handbook")!.readers).toEqual({
      kind: "everyone",
      names: [],
    });
    expect(text).not.toContain("covers the synthetic procedure");
    expect(text).not.toContain("Private planning notes");
  });

  it("labels a private document private, without the owner id, and only for its owner", async () => {
    const mine = await call("/library", cookies["member-maya"]);
    const text = await mine.text();
    const priv = (JSON.parse(text) as LibraryResponse).documents.find((d) => d.id === "doc-private-maya")!;
    expect(priv.readers).toEqual({ kind: "private", names: [] });
    expect(text).not.toContain("member-maya");
    for (const persona of ["member-priya", "member-jordan"] as PersonaId[]) {
      expect((await library(persona)).documents.map((d) => d.id)).not.toContain("doc-private-maya");
    }
  });

  it("never lists a draft generation's documents", async () => {
    await env.CORPUS_DB.batch([
      env.CORPUS_DB.prepare(
        `INSERT INTO corpus_generations (id, state, created_at, updated_at) VALUES ('gen-draft-lib', 'draft', 1, 1)`,
      ),
      env.CORPUS_DB.prepare(
        `INSERT INTO document_catalog (document_id, generation_id, title, access_scope, chunk_count, file_name, updated_at)
         VALUES ('doc-draft-lib', 'gen-draft-lib', 'Draft Library', 'public', 1, 'd.md', 1)`,
      ),
    ]);
    const ids = (await library("member-maya")).documents.map((d) => d.id);
    expect(ids).not.toContain("doc-draft-lib");
  });

  it("drops a document whose chunks disagree on access", async () => {
    await env.CORPUS_DB.prepare(
      `UPDATE chunks SET access_scope = 'department', allowed_departments = '["hr"]'
       WHERE generation_id = ? AND document_id = 'doc-public-handbook' AND chunk_index = 1`,
    ).bind(generationId).run();
    const ids = (await library("member-maya")).documents.map((d) => d.id);
    expect(ids).not.toContain("doc-public-handbook");
    await env.CORPUS_DB.prepare(
      `UPDATE chunks SET access_scope = 'public', allowed_departments = '[]'
       WHERE generation_id = ? AND document_id = 'doc-public-handbook' AND chunk_index = 1`,
    ).bind(generationId).run();
    expect((await library("member-maya")).documents.map((d) => d.id)).toContain("doc-public-handbook");
  });
});

describe("missing ACL metadata fails closed", () => {
  const damage = (sql: string) =>
    env.CORPUS_DB.prepare(sql).bind(generationId).run();

  it("denies a public catalog row whose chunk is private with no owner (metadata '{}')", async () => {
    await damage(
      `UPDATE chunks SET access_scope = 'private', metadata = '{}'
       WHERE generation_id = ? AND document_id = 'doc-public-handbook' AND chunk_index = 1`,
    );
    try {
      for (const persona of Object.keys(PRINCIPALS) as PersonaId[]) {
        expect((await library(persona)).documents.map((d) => d.id), persona).not.toContain("doc-public-handbook");
        const open = await call("/documents/doc-public-handbook", cookies[persona]);
        expect(open.status, persona).toBe(404);
        const found = await call(`/search?q=${encodeURIComponent("handbook")}`, cookies[persona]);
        expect(JSON.stringify(await found.json()), persona).not.toContain("doc-public-handbook");
      }
    } finally {
      await damage(
        `UPDATE chunks SET access_scope = 'public', allowed_departments = '[]', metadata = '{}'
         WHERE generation_id = ? AND document_id = 'doc-public-handbook' AND chunk_index = 1`,
      );
    }
    expect((await library("member-maya")).documents.map((d) => d.id)).toContain("doc-public-handbook");
  });

  it("lists a catalog row only when it has a body, so list and open agree", async () => {
    await env.CORPUS_DB.prepare(
      `DELETE FROM document_bodies WHERE generation_id = ? AND document_id = 'doc-public-security'`,
    ).bind(generationId).run();
    expect((await library("member-maya")).documents.map((d) => d.id)).not.toContain("doc-public-security");
    expect((await call("/documents/doc-public-security", cookies["member-maya"])).status).toBe(404);
  });
});

describe("resolveScopedDocument", () => {
  const maya = PRINCIPALS["member-maya"];

  it("returns the id for a readable document", async () => {
    expect(await resolveScopedDocument(env.CORPUS_DB, generationId, maya, "doc-eng-runbook")).toBe("doc-eng-runbook");
  });

  it("throws NOT_FOUND for unreadable, unknown and out-of-generation ids", async () => {
    for (const id of ["doc-finance-policy", "doc-ops-vendors", "doc-nope", "doc-draft-lib"]) {
      await expect(resolveScopedDocument(env.CORPUS_DB, generationId, maya, id)).rejects.toBeInstanceOf(
        WorkerNotFoundError,
      );
    }
    await expect(
      resolveScopedDocument(env.CORPUS_DB, "gen-draft-lib", maya, "doc-draft-lib"),
    ).rejects.toBeInstanceOf(WorkerNotFoundError);
  });
});
