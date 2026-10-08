import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { workerErrorResponse, WorkerNotFoundError } from "../../../src/lib/cf/worker-errors";
import { chunkDocument } from "../../../src/lib/ingest/chunker";
import { splitSections } from "../../../src/lib/store/library-queries";
import { backfillDocumentCatalog, reconstructBody } from "../../../src/lib/store/document-catalog";
import { CORPUS_DOCUMENT_IDS, seedCorpus } from "./seed";

let generationId: string;

beforeAll(async () => {
  generationId = (await seedCorpus()).generationId;
});

async function ftsHits(term: string): Promise<string[]> {
  const rows = await env.CORPUS_DB.prepare(
    `SELECT c.document_id AS document_id FROM document_catalog_fts f
     JOIN document_catalog c ON c.id = f.rowid
     WHERE document_catalog_fts MATCH ? AND c.generation_id = ? ORDER BY c.document_id`,
  )
    .bind(term, generationId)
    .all<{ document_id: string }>();
  return rows.results.map((row) => row.document_id);
}

describe("NOT_FOUND contract", () => {
  it("answers 404 with a fixed body that carries no resource detail", async () => {
    const response = workerErrorResponse(new WorkerNotFoundError(), "req-nf");
    expect(response.status).toBe(404);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      code: "NOT_FOUND",
      message: "That resource was not found.",
      retryable: false,
      requestId: "req-nf",
    });
    expect(response.headers.get("x-request-id")).toBe("req-nf");
  });
});

describe("document catalog after seed", () => {
  it("writes one catalog row and one exact body per document", async () => {
    const catalog = await env.CORPUS_DB.prepare(
      `SELECT document_id, title, department, version, chunk_count, file_name FROM document_catalog
       WHERE generation_id = ? ORDER BY document_id`,
    )
      .bind(generationId)
      .all<{ document_id: string; title: string; department: string | null; version: string | null; chunk_count: number; file_name: string }>();
    expect(catalog.results.map((row) => row.document_id)).toEqual([...CORPUS_DOCUMENT_IDS].sort());
    const handbook = catalog.results.find((row) => row.document_id === "doc-public-handbook");
    expect(handbook).toMatchObject({
      title: "Employee Handbook",
      department: "hr",
      version: "3.1",
      file_name: "employee-handbook.md",
    });
    expect(catalog.results.find((row) => row.document_id === "doc-eng-runbook")!.chunk_count).toBeGreaterThan(1);
    const bodies = await env.CORPUS_DB.prepare(
      `SELECT reconstructed FROM document_bodies WHERE generation_id = ?`,
    )
      .bind(generationId)
      .all<{ reconstructed: number }>();
    expect(bodies.results).toHaveLength(CORPUS_DOCUMENT_IDS.length);
    expect(bodies.results.every((row) => row.reconstructed === 0)).toBe(true);
  });

  it("chunk offsets index into the stored body for every chunk", async () => {
    const chunks = await env.CORPUS_DB.prepare(
      `SELECT c.document_id, c.content, c.start_offset, c.end_offset, b.body
       FROM chunks c JOIN document_bodies b
         ON b.document_id = c.document_id AND b.generation_id = c.generation_id
       WHERE c.generation_id = ?`,
    )
      .bind(generationId)
      .all<{ document_id: string; content: string; start_offset: number; end_offset: number; body: string }>();
    expect(chunks.results.length).toBeGreaterThan(CORPUS_DOCUMENT_IDS.length);
    const multi = new Set<string>();
    for (const row of chunks.results) {
      expect(row.body.slice(row.start_offset, row.end_offset)).toBe(row.content);
      multi.add(row.document_id);
    }
    expect(multi.size).toBe(CORPUS_DOCUMENT_IDS.length);
  });

  it("keeps the title and heading FTS in sync across insert, update and delete", async () => {
    expect(await ftsHits("incident")).toEqual(["doc-eng-runbook"]);
    expect(await ftsHits("postmortem")).toEqual(["doc-eng-runbook"]);

    await env.CORPUS_DB.prepare(
      `UPDATE document_catalog SET title = 'Outage Guide' WHERE document_id = 'doc-eng-runbook' AND generation_id = ?`,
    )
      .bind(generationId)
      .run();
    expect(await ftsHits("incident")).toEqual([]);
    expect(await ftsHits("outage")).toEqual(["doc-eng-runbook"]);

    await env.CORPUS_DB.prepare(
      `DELETE FROM document_catalog WHERE document_id = 'doc-eng-runbook' AND generation_id = ?`,
    )
      .bind(generationId)
      .run();
    expect(await ftsHits("outage")).toEqual([]);
    expect(await ftsHits("rollback")).toEqual([]);
  });
});

describe("catalog backfill", () => {
  it("rebuilds missing rows from chunks, marks bodies reconstructed, never overwrites, and is idempotent", async () => {
    const seeded = await seedCorpus();
    const gen = seeded.generationId;
    await env.CORPUS_DB.batch([
      env.CORPUS_DB.prepare(`DELETE FROM document_catalog WHERE generation_id = ? AND document_id <> 'doc-public-security'`).bind(gen),
      env.CORPUS_DB.prepare(`DELETE FROM document_bodies WHERE generation_id = ? AND document_id <> 'doc-public-security'`).bind(gen),
    ]);
    const added = await backfillDocumentCatalog(env.CORPUS_DB, gen);
    expect(added).toBe(CORPUS_DOCUMENT_IDS.length - 1);
    const bodies = await env.CORPUS_DB.prepare(
      `SELECT document_id, reconstructed FROM document_bodies WHERE generation_id = ? ORDER BY document_id`,
    )
      .bind(gen)
      .all<{ document_id: string; reconstructed: number }>();
    expect(bodies.results).toHaveLength(CORPUS_DOCUMENT_IDS.length);
    for (const row of bodies.results) {
      expect(row.reconstructed).toBe(row.document_id === "doc-public-security" ? 0 : 1);
    }
    const rebuilt = await env.CORPUS_DB.prepare(
      `SELECT title, headings_json, access_scope, chunk_count FROM document_catalog WHERE generation_id = ? AND document_id = 'doc-eng-runbook'`,
    )
      .bind(gen)
      .first<{ title: string; headings_json: string; access_scope: string; chunk_count: number }>();
    expect(rebuilt!.title).toBe("Incident Runbook");
    expect(JSON.parse(rebuilt!.headings_json)).toEqual(["Paging", "Rollback", "Postmortem"]);
    expect(rebuilt!.access_scope).toBe("department");
    expect(await backfillDocumentCatalog(env.CORPUS_DB, gen)).toBe(0);
  });
});

describe("reconstructed bodies", () => {
  it("restore the original headings as reader sections", async () => {
    const gen = (await seedCorpus()).generationId;
    await env.CORPUS_DB.batch([
      env.CORPUS_DB.prepare(`DELETE FROM document_catalog WHERE generation_id = ?`).bind(gen),
      env.CORPUS_DB.prepare(`DELETE FROM document_bodies WHERE generation_id = ?`).bind(gen),
    ]);
    await backfillDocumentCatalog(env.CORPUS_DB, gen);
    const row = await env.CORPUS_DB.prepare(
      `SELECT body, reconstructed FROM document_bodies WHERE generation_id = ? AND document_id = 'doc-eng-runbook'`,
    )
      .bind(gen)
      .first<{ body: string; reconstructed: number }>();
    expect(row!.reconstructed).toBe(1);
    const headings = splitSections(row!.body, "Incident Runbook").map((section) => section.heading);
    expect(headings).toEqual(expect.arrayContaining(["Paging", "Rollback", "Postmortem"]));
  });

  it("groups chunks by heading and drops only the verified source-range overlap between neighbours", () => {
    const body = reconstructBody([
      { heading: "Paging", content: "Page the on-call engineer first. Then confirm the alert.", start_offset: 10, end_offset: 66 },
      { heading: "Paging", content: "Then confirm the alert. Open an incident channel.", start_offset: 43, end_offset: 92 },
      { heading: "Rollback", content: "Roll back the last release.", start_offset: 110, end_offset: 137 },
      { heading: "Rollback", content: "Unrelated second chunk.", start_offset: 138, end_offset: 161 },
    ]);
    expect(body).toBe(
      "## Paging\n\nPage the on-call engineer first. Then confirm the alert. Open an incident channel." +
        "\n\n## Rollback\n\nRoll back the last release.\n\nUnrelated second chunk.",
    );
  });

  it("keeps text when overlapping ranges do not actually match", () => {
    const body = reconstructBody([
      { heading: "A", content: "The first chunk ends with alpha beta gamma.", start_offset: 0, end_offset: 42 },
      { heading: "A", content: "alpha beta gamma! Then a different tail.", start_offset: 25, end_offset: 65 },
    ]);
    expect(body).toContain("alpha beta gamma.\n\nalpha beta gamma! Then a different tail.");
  });

  it("keeps two sections that share a heading and repeated text separate, using real chunker output", () => {
    const sentences = (prefix: string) =>
      Array.from({ length: 160 }, (_, i) => `${prefix} sentence number ${i} says the same thing twice.`).join(" ");
    const shared = sentences("Shared");
    const content = `# Guide\n\n## Steps\n\n${shared}\n\n## Steps\n\n${shared}\n`;
    const chunks = chunkDocument({ documentId: "doc-repeat", content });
    expect(chunks.length).toBeGreaterThan(3);
    const rows = chunks.map((chunk) => ({
      heading: chunk.sectionHeading,
      content: chunk.content,
      start_offset: chunk.charStart,
      end_offset: chunk.charEnd,
    }));
    expect(reconstructBody(rows)).toBe(`## Steps\n\n${shared}\n\n## Steps\n\n${shared}`);
  });

  it("keeps one section when a long whitespace gap separates two chunks of the same heading", () => {
    const body = reconstructBody([
      { heading: "Policy", content: "First half of the policy.", start_offset: 12, end_offset: 37 },
      { heading: "Policy", content: "Second half of the policy.", start_offset: 37 + 1600, end_offset: 37 + 1626 },
    ]);
    expect(body).toBe("## Policy\n\nFirst half of the policy.\n\nSecond half of the policy.");
  });

  it("keeps repeated text inside one section when the chunk ranges do not overlap", () => {
    const paragraph = "Repeat this line exactly, it is policy text.";
    const body = reconstructBody([
      { heading: "Policy", content: paragraph, start_offset: 12, end_offset: 56 },
      { heading: "Policy", content: paragraph, start_offset: 58, end_offset: 102 },
    ]);
    expect(body).toBe(`## Policy\n\n${paragraph}\n\n${paragraph}`);
  });
});

describe("catalog backfill ACL consistency", () => {
  it("throws when chunks of one document disagree on ACL instead of copying the first chunk's", async () => {
    const seeded = await seedCorpus();
    const gen = seeded.generationId;
    await env.CORPUS_DB.batch([
      env.CORPUS_DB.prepare(`DELETE FROM document_catalog WHERE generation_id = ?`).bind(gen),
      env.CORPUS_DB.prepare(`DELETE FROM document_bodies WHERE generation_id = ?`).bind(gen),
      env.CORPUS_DB.prepare(
        `UPDATE chunks SET access_scope = 'public'
         WHERE generation_id = ? AND document_id = 'doc-eng-runbook' AND chunk_index = 1`,
      ).bind(gen),
    ]);
    await expect(backfillDocumentCatalog(env.CORPUS_DB, gen)).rejects.toThrow(/ACL/);
    const rows = await env.CORPUS_DB.prepare(
      `SELECT COUNT(*) AS n FROM document_catalog WHERE generation_id = ? AND document_id = 'doc-eng-runbook'`,
    )
      .bind(gen)
      .first<{ n: number }>();
    expect(rows!.n).toBe(0);
  });

  async function prepareGeneration(...mutations: string[]): Promise<string> {
    const gen = (await seedCorpus()).generationId;
    await env.CORPUS_DB.batch([
      env.CORPUS_DB.prepare(`DELETE FROM document_catalog WHERE generation_id = ?`).bind(gen),
      env.CORPUS_DB.prepare(`DELETE FROM document_bodies WHERE generation_id = ?`).bind(gen),
      ...mutations.map((sql) => env.CORPUS_DB.prepare(sql).bind(gen)),
    ]);
    return gen;
  }

  async function writtenRows(gen: string): Promise<number> {
    const row = await env.CORPUS_DB.prepare(
      `SELECT (SELECT COUNT(*) FROM document_catalog WHERE generation_id = ?1)
            + (SELECT COUNT(*) FROM document_bodies WHERE generation_id = ?1) AS n`,
    )
      .bind(gen)
      .first<{ n: number }>();
    return row!.n;
  }

  it("throws when private chunks share scope, arrays and a stale acl_group but differ in owner, and writes nothing", async () => {
    const gen = await prepareGeneration(
      `UPDATE chunks SET access_scope = 'private', allowed_roles = '[]', allowed_departments = '[]',
         acl_group = 'stale000000000000000000000000000',
         metadata = json_set(metadata, '$.owner_user_id', CASE chunk_index WHEN 0 THEN 'alice' ELSE 'bob' END)
       WHERE generation_id = ? AND document_id = 'doc-eng-runbook'`,
    );
    await expect(backfillDocumentCatalog(env.CORPUS_DB, gen)).rejects.toThrow(/ACL/);
    expect(await writtenRows(gen)).toBe(0);
  });

  it("writes nothing when a consistent document sorts before a mixed one", async () => {
    const gen = await prepareGeneration(
      `UPDATE chunks SET allowed_departments = '["support"]'
       WHERE generation_id = ? AND document_id = 'doc-public-handbook' AND chunk_index = 1`,
    );
    await expect(backfillDocumentCatalog(env.CORPUS_DB, gen)).rejects.toThrow(/ACL/);
    expect(await writtenRows(gen)).toBe(0);
  });

  it.each([
    ["a numeric owner", `json_set(metadata, '$.owner_user_id', 42)`],
    ["an empty owner", `json_set(metadata, '$.owner_user_id', '')`],
    ["a missing owner", `json_remove(metadata, '$.owner_user_id')`],
    ["an object owner", `json_set(metadata, '$.owner_user_id', json('{"id":"member-maya"}'))`],
    ["unparseable metadata", `'not json'`],
  ])("throws on a private document with %s and writes nothing", async (_label, expression) => {
    const gen = await prepareGeneration(
      `UPDATE chunks SET metadata = ${expression}
       WHERE generation_id = ? AND document_id = 'doc-private-maya'`,
    );
    await expect(backfillDocumentCatalog(env.CORPUS_DB, gen)).rejects.toThrow(/ACL|owner/);
    expect(await writtenRows(gen)).toBe(0);
  });

  it("rebuilds a consistent private document with its owner", async () => {
    const gen = await prepareGeneration();
    expect(await backfillDocumentCatalog(env.CORPUS_DB, gen)).toBe(CORPUS_DOCUMENT_IDS.length);
    const row = await env.CORPUS_DB.prepare(
      `SELECT access_scope, json_extract(metadata, '$.owner_user_id') AS owner FROM document_catalog
       WHERE generation_id = ? AND document_id = 'doc-private-maya'`,
    )
      .bind(gen)
      .first<{ access_scope: string; owner: string }>();
    expect(row).toEqual({ access_scope: "private", owner: "member-maya" });
  });
});

describe("migration 0004 over an existing 0001-0003 database", () => {
  it("applies on top of live chunk data and the backfill then fills it", async () => {
    const seeded = await seedCorpus();
    const migration = env.TEST_CORPUS_MIGRATIONS.find((m) => m.name.startsWith("0004"));
    expect(migration).toBeDefined();
    await env.CORPUS_DB.batch([
      env.CORPUS_DB.prepare(`DROP TRIGGER document_catalog_ai`),
      env.CORPUS_DB.prepare(`DROP TRIGGER document_catalog_ad`),
      env.CORPUS_DB.prepare(`DROP TRIGGER document_catalog_au`),
      env.CORPUS_DB.prepare(`DROP TABLE document_catalog_fts`),
      env.CORPUS_DB.prepare(`DROP TABLE document_catalog`),
      env.CORPUS_DB.prepare(`DROP TABLE document_bodies`),
    ]);
    const chunksBefore = await env.CORPUS_DB.prepare(`SELECT COUNT(*) AS n FROM chunks`).first<{ n: number }>();
    for (const query of migration!.queries) {
      await env.CORPUS_DB.prepare(query).run();
    }
    const chunksAfter = await env.CORPUS_DB.prepare(`SELECT COUNT(*) AS n FROM chunks`).first<{ n: number }>();
    expect(chunksAfter!.n).toBe(chunksBefore!.n);
    expect(await backfillDocumentCatalog(env.CORPUS_DB, seeded.generationId)).toBe(CORPUS_DOCUMENT_IDS.length);
    const hits = await env.CORPUS_DB.prepare(
      `SELECT c.document_id FROM document_catalog_fts f JOIN document_catalog c ON c.id = f.rowid
       WHERE document_catalog_fts MATCH 'vendor' AND c.generation_id = ?`,
    )
      .bind(seeded.generationId)
      .all<{ document_id: string }>();
    expect(hits.results.map((r) => r.document_id)).toEqual(["doc-ops-vendors"]);
  });
});
