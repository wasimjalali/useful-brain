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
};

type AclChunkRow = {
  access_scope: string;
  allowed_roles: string;
  allowed_departments: string;
  acl_group: string;
  metadata: string;
};

type MissingDocument = { documentId: string; path: string };

const BACKFILL_PAGE = 100;
const ACCESS_SCOPES = new Set(["public", "role", "department", "private"]);

function stringArray(raw: string, documentId: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`document ${documentId} has a chunk with an unreadable ACL list`);
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`document ${documentId} has a chunk with an invalid ACL list`);
  }
  return [...parsed].sort();
}

/**
 * The authoritative ACL of one chunk as a canonical string: scope, sorted
 * roles, sorted departments, the private owner from metadata and the stored
 * acl_group. Fails closed on an unknown scope, malformed lists or metadata,
 * a non-string owner, or a private chunk without a non-empty owner.
 */
function chunkAclKey(chunk: AclChunkRow, documentId: string): string {
  if (!ACCESS_SCOPES.has(chunk.access_scope)) {
    throw new Error(`document ${documentId} has a chunk with an unknown ACL scope`);
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(chunk.metadata);
  } catch {
    throw new Error(`document ${documentId} has a chunk with unreadable ACL metadata`);
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`document ${documentId} has a chunk with invalid ACL metadata`);
  }
  const owner = (metadata as Record<string, unknown>).owner_user_id;
  if (owner !== undefined && typeof owner !== "string") {
    throw new Error(`document ${documentId} has a chunk with a non-string ACL owner`);
  }
  if (chunk.access_scope === "private" && !owner) {
    throw new Error(`document ${documentId} has a private chunk without an ACL owner`);
  }
  return JSON.stringify([
    chunk.access_scope,
    stringArray(chunk.allowed_roles, documentId),
    stringArray(chunk.allowed_departments, documentId),
    owner ?? "",
    chunk.acl_group,
  ]);
}

async function listMissingDocuments(db: SqlExecutor, generationId: string): Promise<MissingDocument[]> {
  const missing: MissingDocument[] = [];
  let after = "";
  for (;;) {
    const page = await db
      .prepare(
        `SELECT DISTINCT c.document_id, d.path
         FROM chunks c JOIN documents d ON d.id = c.document_id
         WHERE c.generation_id = ? AND c.document_id > ?
           AND (
             NOT EXISTS (SELECT 1 FROM document_catalog k
                         WHERE k.document_id = c.document_id AND k.generation_id = c.generation_id)
             OR NOT EXISTS (SELECT 1 FROM document_bodies b
                            WHERE b.document_id = c.document_id AND b.generation_id = c.generation_id)
           )
         ORDER BY c.document_id LIMIT ?`,
      )
      .bind(generationId, after, BACKFILL_PAGE)
      .all<{ document_id: string; path: string }>();
    for (const row of page.results) {
      missing.push({ documentId: row.document_id, path: row.path });
    }
    if (page.results.length < BACKFILL_PAGE) {
      return missing;
    }
    after = page.results[page.results.length - 1].document_id;
  }
}

/** Pages over a document's chunk ACL columns (no text) and returns its one ACL key. */
async function documentAclKey(db: SqlExecutor, generationId: string, documentId: string): Promise<string> {
  let key: string | null = null;
  for (let offset = 0; ; offset += BACKFILL_PAGE) {
    const page = await db
      .prepare(
        `SELECT access_scope, allowed_roles, allowed_departments, acl_group, metadata
         FROM chunks WHERE generation_id = ? AND document_id = ?
         ORDER BY chunk_index LIMIT ? OFFSET ?`,
      )
      .bind(generationId, documentId, BACKFILL_PAGE, offset)
      .all<AclChunkRow>();
    for (const chunk of page.results) {
      const chunkKey = chunkAclKey(chunk, documentId);
      if (key === null) {
        key = chunkKey;
      } else if (chunkKey !== key) {
        throw new Error(`document ${documentId} has chunks with inconsistent ACL`);
      }
    }
    if (page.results.length < BACKFILL_PAGE) {
      break;
    }
  }
  if (key === null) {
    throw new Error(`document ${documentId} has no chunks to derive an ACL from`);
  }
  return key;
}

/**
 * Idempotent: rebuilds catalog and body rows for documents of a generation
 * that lack them. The original text is not stored for such generations, so the
 * body is reconstructed from chunk text (overlap repeated) and marked
 * `reconstructed = 1`; offsets do not index into a reconstructed body.
 * Existing rows are never overwritten.
 *
 * Two phases. First a paged pass validates the authoritative ACL (scope, roles,
 * departments, private owner, acl_group) of every chunk of every document that
 * needs repair; any invalid or inconsistent document throws before anything is
 * written. Then each document is written in one catalog+body batch, from the
 * same chunks re-read a page at a time and re-checked against the validated ACL.
 * Returns the number of documents added.
 */
export async function backfillDocumentCatalog(
  db: SqlExecutor,
  generationId: string,
  now = Date.now(),
): Promise<number> {
  const missing = await listMissingDocuments(db, generationId);
  const validated = new Map<string, string>();
  for (const { documentId } of missing) {
    validated.set(documentId, await documentAclKey(db, generationId, documentId));
  }
  let added = 0;
  for (const { documentId, path } of missing) {
    const expectedKey = validated.get(documentId)!;
    const chunks: BackfillChunkRow[] = [];
    let first: AclChunkRow | null = null;
    for (let offset = 0; ; offset += BACKFILL_PAGE) {
      const page = await db
        .prepare(
          `SELECT heading, content, access_scope, allowed_roles, allowed_departments, acl_group, metadata
           FROM chunks WHERE generation_id = ? AND document_id = ?
           ORDER BY chunk_index LIMIT ? OFFSET ?`,
        )
        .bind(generationId, documentId, BACKFILL_PAGE, offset)
        .all<BackfillChunkRow & AclChunkRow>();
      for (const chunk of page.results) {
        if (chunkAclKey(chunk, documentId) !== expectedKey) {
          throw new Error(`document ${documentId} changed ACL during backfill`);
        }
        first ??= chunk;
        chunks.push({ heading: chunk.heading, content: chunk.content });
      }
      if (page.results.length < BACKFILL_PAGE) {
        break;
      }
    }
    if (!first) {
      throw new Error(`document ${documentId} lost its chunks during backfill`);
    }
    // chunkAclKey already proved this parses to an object.
    const metadata = JSON.parse(first.metadata) as Record<string, unknown>;
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
