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
  heading: string;
  content: string;
  access_scope: string;
  allowed_roles: string;
  allowed_departments: string;
  acl_group: string;
  metadata: string;
};

const BACKFILL_PAGE = 100;

/**
 * Idempotent: rebuilds catalog and body rows for documents of a generation
 * that lack them. The original text is not stored for such generations, so the
 * body is reconstructed from chunk text (overlap repeated) and marked
 * `reconstructed = 1`; offsets do not index into a reconstructed body.
 * Existing rows are never overwritten. Chunks are read one document at a time,
 * a page at a time. Throws if the chunks of a document disagree on their ACL.
 * Returns the number of documents added.
 */
export async function backfillDocumentCatalog(
  db: SqlExecutor,
  generationId: string,
  now = Date.now(),
): Promise<number> {
  const missing = await db
    .prepare(
      `SELECT DISTINCT c.document_id, d.path
       FROM chunks c JOIN documents d ON d.id = c.document_id
       WHERE c.generation_id = ?
         AND (
           NOT EXISTS (SELECT 1 FROM document_catalog k
                       WHERE k.document_id = c.document_id AND k.generation_id = c.generation_id)
           OR NOT EXISTS (SELECT 1 FROM document_bodies b
                          WHERE b.document_id = c.document_id AND b.generation_id = c.generation_id)
         )
       ORDER BY c.document_id`,
    )
    .bind(generationId)
    .all<{ document_id: string; path: string }>();
  let added = 0;
  for (const { document_id: documentId, path } of missing.results) {
    const chunks: BackfillChunkRow[] = [];
    for (let offset = 0; ; offset += BACKFILL_PAGE) {
      const page = await db
        .prepare(
          `SELECT heading, content, access_scope, allowed_roles, allowed_departments, acl_group, metadata
           FROM chunks WHERE generation_id = ? AND document_id = ?
           ORDER BY chunk_index LIMIT ? OFFSET ?`,
        )
        .bind(generationId, documentId, BACKFILL_PAGE, offset)
        .all<BackfillChunkRow>();
      chunks.push(...page.results);
      if (page.results.length < BACKFILL_PAGE) {
        break;
      }
    }
    const first = chunks[0];
    for (const chunk of chunks) {
      if (
        chunk.access_scope !== first.access_scope ||
        chunk.allowed_roles !== first.allowed_roles ||
        chunk.allowed_departments !== first.allowed_departments ||
        chunk.acl_group !== first.acl_group
      ) {
        throw new Error(`document ${documentId} has chunks with inconsistent ACL`);
      }
    }
    let metadata: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(first.metadata);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      metadata = {};
    }
    const file = fileNameOf(path);
    const headings = [...new Set(chunks.map((chunk) => chunk.heading).filter(Boolean))];
    await db.batch([
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
    ]);
    added += 1;
  }
  return added;
}
