import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { workerErrorResponse, WorkerNotFoundError } from "../../../src/lib/cf/worker-errors";
import {
  backfillDocumentCatalog,
  resetCatalogRepairCache,
} from "../../../src/lib/store/document-catalog";
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
    resetCatalogRepairCache();
    const added = await backfillDocumentCatalog(env.CORPUS_DB, gen);
    expect(added).toBe(CORPUS_DOCUMENT_IDS.length);
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
    resetCatalogRepairCache();
    expect(await backfillDocumentCatalog(env.CORPUS_DB, gen)).toBe(0);
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
    resetCatalogRepairCache();
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
