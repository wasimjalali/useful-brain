import type { SqlExecutor } from "./corpus-d1";

export const UPSERT_CATALOG_SQL = `INSERT INTO document_catalog (
  document_id, generation_id, title, department, version, effective_date, headings_json,
  access_scope, allowed_roles, allowed_departments, metadata, chunk_count, file_name, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(document_id, generation_id) DO UPDATE SET
  title = excluded.title,
  department = excluded.department,
  version = excluded.version,
  effective_date = excluded.effective_date,
  headings_json = excluded.headings_json,
  access_scope = excluded.access_scope,
  allowed_roles = excluded.allowed_roles,
  allowed_departments = excluded.allowed_departments,
  metadata = excluded.metadata,
  chunk_count = excluded.chunk_count,
  file_name = excluded.file_name,
  updated_at = excluded.updated_at`;

export const UPSERT_BODY_SQL = `INSERT INTO document_bodies (document_id, generation_id, body, reconstructed)
VALUES (?, ?, ?, ?)
ON CONFLICT(document_id, generation_id) DO UPDATE SET
  body = excluded.body,
  reconstructed = excluded.reconstructed`;

const INSERT_MISSING_CATALOG_SQL = `${UPSERT_CATALOG_SQL.split("ON CONFLICT")[0]}ON CONFLICT(document_id, generation_id) DO NOTHING`;
const INSERT_MISSING_BODY_SQL = `${UPSERT_BODY_SQL.split("ON CONFLICT")[0]}ON CONFLICT(document_id, generation_id) DO NOTHING`;

export function optionalMetadataText(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function fileNameOf(path: string): string {
  return path.split("/").pop() || path;
}

type BackfillChunkRow = {
  document_id: string;
  path: string;
  heading: string;
  content: string;
  access_scope: string;
  allowed_roles: string;
  allowed_departments: string;
  metadata: string;
};

const repaired = new Set<string>();

export function resetCatalogRepairCache(): void {
  repaired.clear();
}

/**
 * Idempotent: rebuilds catalog and body rows for documents of a generation
 * that lack them. The original text is not stored for such generations, so the
 * body is reconstructed from chunk text (overlap repeated) and marked
 * `reconstructed = 1`; offsets do not index into a reconstructed body.
 * Existing rows are never overwritten. Returns the number of documents added.
 */
export async function backfillDocumentCatalog(
  db: SqlExecutor,
  generationId: string,
  now = Date.now(),
): Promise<number> {
  if (repaired.has(generationId)) {
    return 0;
  }
  const counts = await db
    .prepare(
      `SELECT
         (SELECT COUNT(DISTINCT document_id) FROM chunks WHERE generation_id = ?) AS chunked,
         (SELECT COUNT(*) FROM document_catalog WHERE generation_id = ?) AS cataloged,
         (SELECT COUNT(*) FROM document_bodies WHERE generation_id = ?) AS bodies`,
    )
    .bind(generationId, generationId, generationId)
    .first<{ chunked: number; cataloged: number; bodies: number }>();
  if (counts && counts.cataloged >= counts.chunked && counts.bodies >= counts.chunked) {
    repaired.add(generationId);
    return 0;
  }
  const rows = await db
    .prepare(
      `SELECT c.document_id, d.path, c.heading, c.content, c.access_scope,
              c.allowed_roles, c.allowed_departments, c.metadata
       FROM chunks c JOIN documents d ON d.id = c.document_id
       WHERE c.generation_id = ?
       ORDER BY c.document_id, c.chunk_index`,
    )
    .bind(generationId)
    .all<BackfillChunkRow>();
  const grouped = new Map<string, BackfillChunkRow[]>();
  for (const row of rows.results) {
    const list = grouped.get(row.document_id) ?? [];
    list.push(row);
    grouped.set(row.document_id, list);
  }
  const statements: Array<ReturnType<SqlExecutor["prepare"]>> = [];
  for (const [documentId, chunks] of grouped) {
    const first = chunks[0];
    let metadata: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(first.metadata);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      metadata = {};
    }
    const file = fileNameOf(first.path);
    const headings = [...new Set(chunks.map((chunk) => chunk.heading).filter(Boolean))];
    statements.push(
      db.prepare(INSERT_MISSING_CATALOG_SQL).bind(
        documentId,
        generationId,
        optionalMetadataText(metadata, "title") ?? file.replace(/\.md$/i, ""),
        optionalMetadataText(metadata, "department"),
        optionalMetadataText(metadata, "version"),
        optionalMetadataText(metadata, "effective_date"),
        JSON.stringify(headings),
        first.access_scope,
        first.allowed_roles,
        first.allowed_departments,
        first.metadata,
        chunks.length,
        file,
        now,
      ),
      db.prepare(INSERT_MISSING_BODY_SQL).bind(
        documentId,
        generationId,
        chunks.map((chunk) => chunk.content).join("\n\n"),
        1,
      ),
    );
  }
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
  repaired.add(generationId);
  return grouped.size;
}
