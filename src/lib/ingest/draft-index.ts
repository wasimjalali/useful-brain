import type { AccessScope } from "../acl/acl-group";
import { aclGroupKey } from "../acl/acl-group";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../embeddings/instructions";
import { embedWithWorkersAi, type WorkersAiRunner } from "../embeddings/workers-ai-embed";
import { REAL_STACK_FINGERPRINT } from "../retrieve/fingerprint";
import type { SqlExecutor } from "../store/corpus-d1";
import {
  fileNameOf,
  UPSERT_BODY_SQL,
  UPSERT_CATALOG_SQL,
} from "../store/document-catalog";
import { UPSERT_CHUNK_SQL } from "../store/generations";
import { chunkDocument } from "./chunker";
import { UploadFailure } from "./error-codes";
import { contentDigest, generationNamespace, sha256Hex, vectorIdForChunk } from "./digests";

export const UPLOADS_SOURCE_ID = "src-uploads";
const WRITE_BATCH = 20;
const VECTOR_GET_LIMIT = 20;
const VECTOR_UPSERT_LIMIT = 20;
const VECTOR_DELETE_LIMIT = 100;
const EMBED_BATCH = 8;
export const COPY_PAGE = 40;
export const EMBED_RANGE = 40;

export type VectorRecord = {
  id: string;
  values: number[];
  namespace: string;
  metadata: Record<string, string>;
};

/** The Vectorize binding surface the pipeline needs. Tests inject a recording fake. */
export type VectorPort = {
  upsert(vectors: VectorRecord[]): Promise<{ mutationId?: string } | void>;
  getByIds(ids: string[]): Promise<
    Array<{
      id: string;
      values?: ArrayLike<number>;
      namespace?: string;
      metadata?: Record<string, unknown>;
    }>
  >;
  deleteByIds(ids: string[]): Promise<{ mutationId?: string } | void>;
  describe(): Promise<{ processedUpToMutation?: unknown }>;
};

export type IndexContext = {
  db: SqlExecutor;
  ai: WorkersAiRunner | null;
  vectors: VectorPort | null;
};

export type DocumentToIndex = {
  documentId: string;
  title: string;
  sourcePath: string;
  sourceName: string;
  accessScope: AccessScope;
  allowedRoles: string[];
  allowedDepartments: string[];
  /** Catalog fields and anything else kept with the chunks (owner_user_id for private). */
  metadata: Record<string, unknown>;
  r2Key: string;
};

function ownerOfMetadata(metadata: Record<string, unknown>): string {
  return typeof metadata.owner_user_id === "string" ? metadata.owner_user_id : "";
}

function chunksOf(arr: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let index = 0; index < arr.length; index += size) {
    out.push(arr.slice(index, index + size));
  }
  return out;
}

async function recordMutation(
  db: SqlExecutor,
  generationId: string,
  result: { mutationId?: string } | void,
  now: number,
): Promise<string | null> {
  const mutationId = result && typeof result.mutationId === "string" ? result.mutationId : "";
  if (!mutationId) {
    return null;
  }
  await db
    .prepare(
      `INSERT INTO vector_mutations (generation_id, mutation_id, recorded_at)
       VALUES (?, ?, ?)
       ON CONFLICT(generation_id, mutation_id) DO NOTHING`,
    )
    .bind(generationId, mutationId, now)
    .run();
  return mutationId;
}

export async function deleteVectors(
  ctx: IndexContext,
  generationId: string,
  vectorIds: string[],
  now: number,
): Promise<void> {
  if (!ctx.vectors) {
    return;
  }
  for (const batch of chunksOf(vectorIds, VECTOR_DELETE_LIMIT)) {
    await recordMutation(ctx.db, generationId, await ctx.vectors.deleteByIds(batch), now);
  }
}

/**
 * Replaces everything the draft holds for one document: old vectors, chunks,
 * version, catalog and body rows go first, then the new version and chunks are
 * written. Safe to run again after a partial failure.
 */
export async function writeDocumentChunks(
  ctx: IndexContext,
  input: {
    generationId: string;
    doc: DocumentToIndex;
    body: string;
    ensureDocumentRow: boolean;
    now?: number;
  },
): Promise<{ chunkCount: number; headings: string[] }> {
  const now = input.now ?? Date.now();
  const { db } = ctx;
  const { generationId, doc } = input;
  if (input.ensureDocumentRow) {
    await db
      .prepare(
        `INSERT INTO sources (id, kind, display_name, config_json, created_at)
         VALUES (?, 'upload', 'Uploads', '{}', ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(UPLOADS_SOURCE_ID, now)
      .run();
    await db
      .prepare(
        `INSERT INTO documents (id, source_id, path, access_scope, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET path = excluded.path, access_scope = excluded.access_scope`,
      )
      .bind(doc.documentId, UPLOADS_SOURCE_ID, doc.sourcePath, doc.accessScope, now)
      .run();
  }
  const old = await db
    .prepare(`SELECT vector_id FROM chunks WHERE generation_id = ? AND document_id = ?`)
    .bind(generationId, doc.documentId)
    .all<{ vector_id: string }>();
  await deleteVectors(
    ctx,
    generationId,
    old.results.map((row) => row.vector_id),
    now,
  );
  await db.batch([
    db.prepare(`DELETE FROM chunks WHERE generation_id = ? AND document_id = ?`).bind(generationId, doc.documentId),
    db.prepare(`DELETE FROM document_catalog WHERE generation_id = ? AND document_id = ?`).bind(generationId, doc.documentId),
    db.prepare(`DELETE FROM document_bodies WHERE generation_id = ? AND document_id = ?`).bind(generationId, doc.documentId),
    db.prepare(`DELETE FROM document_versions WHERE generation_id = ? AND document_id = ?`).bind(generationId, doc.documentId),
  ]);
  const versionId = `dv-${(await contentDigest(`${doc.documentId}:${generationId}`)).slice(0, 40)}`;
  await db
    .prepare(
      `INSERT INTO document_versions (
         id, document_id, generation_id, r2_key, content_digest, byte_size, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(document_id, generation_id) DO NOTHING`,
    )
    .bind(
      versionId,
      doc.documentId,
      generationId,
      doc.r2Key,
      await contentDigest(input.body),
      new TextEncoder().encode(input.body).byteLength,
      now,
    )
    .run();
  const chunks = chunkDocument(
    { documentId: doc.documentId, content: input.body },
    {
      maxTokens: REAL_STACK_FINGERPRINT.maxTokens,
      overlapTokens: REAL_STACK_FINGERPRINT.overlapTokens,
    },
  );
  const ownerUserId = ownerOfMetadata(doc.metadata);
  const aclGroup = await aclGroupKey({
    accessScope: doc.accessScope,
    allowedRoles: doc.allowedRoles,
    allowedDepartments: doc.allowedDepartments,
    ownerUserId,
  });
  const metadata = JSON.stringify({
    ...doc.metadata,
    owner_user_id: ownerUserId,
    title: doc.title,
    source_name: doc.sourceName,
  });
  const pending: Array<ReturnType<SqlExecutor["prepare"]>> = [];
  for (const chunk of chunks) {
    const storedChunkId = `${chunk.chunkId}--${generationId}`;
    pending.push(
      db.prepare(UPSERT_CHUNK_SQL).bind(
        storedChunkId,
        doc.documentId,
        versionId,
        generationId,
        chunk.sectionHeading,
        chunk.chunkIndex,
        chunk.content,
        chunk.charStart,
        chunk.charEnd,
        await contentDigest(chunk.content),
        await vectorIdForChunk(storedChunkId),
        aclGroup,
        doc.accessScope,
        JSON.stringify(doc.allowedRoles),
        JSON.stringify(doc.allowedDepartments),
        metadata,
        now,
      ),
    );
    if (pending.length >= WRITE_BATCH) {
      await db.batch(pending.splice(0, pending.length));
    }
  }
  if (pending.length > 0) {
    await db.batch(pending);
  }
  const headings = [...new Set(chunks.map((chunk) => chunk.sectionHeading).filter(Boolean))];
  return { chunkCount: chunks.length, headings };
}

type StoredChunk = {
  chunk_id: string;
  vector_id: string;
  content: string;
  content_digest: string;
  acl_group: string;
};

/**
 * True when vectors of this generation can be copied into a new one: same
 * embedding model and dimensions as the current configuration. The document
 * instruction is a constant, so it cannot differ. Every reuse path asks this.
 */
async function embeddingsReusableFrom(db: SqlExecutor, generationId: string): Promise<boolean> {
  const source = await db
    .prepare(`SELECT embedding_model, embedding_dimensions FROM corpus_generations WHERE id = ?`)
    .bind(generationId)
    .first<{ embedding_model: string; embedding_dimensions: number }>();
  return (
    source !== null &&
    source.embedding_model === EMBEDDING_MODEL &&
    source.embedding_dimensions === EMBEDDING_DIMENSIONS
  );
}

async function reusableVectors(
  ctx: IndexContext,
  reuseFromGenerationId: string | null,
  rows: StoredChunk[],
): Promise<Map<string, number[]>> {
  const reusable = new Map<string, number[]>();
  if (!ctx.vectors || !reuseFromGenerationId || rows.length === 0) {
    return reusable;
  }
  if (!(await embeddingsReusableFrom(ctx.db, reuseFromGenerationId))) {
    return reusable;
  }
  const digests = [...new Set(rows.map((row) => row.content_digest))];
  const found = await ctx.db
    .prepare(
      `SELECT content_digest, vector_id FROM chunks
       WHERE generation_id = ? AND content_digest IN (${digests.map(() => "?").join(",")})`,
    )
    .bind(reuseFromGenerationId, ...digests)
    .all<{ content_digest: string; vector_id: string }>();
  const oldIdByDigest = new Map<string, string>();
  for (const row of found.results) {
    if (!oldIdByDigest.has(row.content_digest)) {
      oldIdByDigest.set(row.content_digest, row.vector_id);
    }
  }
  const valuesById = new Map<string, number[]>();
  for (const batch of chunksOf([...new Set(oldIdByDigest.values())], VECTOR_GET_LIMIT)) {
    for (const vector of await ctx.vectors.getByIds(batch)) {
      if (vector.values && vector.values.length === EMBEDDING_DIMENSIONS) {
        valuesById.set(vector.id, Array.from(vector.values));
      }
    }
  }
  for (const [digest, oldId] of oldIdByDigest) {
    const values = valuesById.get(oldId);
    if (values) {
      reusable.set(digest, values);
    }
  }
  return reusable;
}

/**
 * Embeds (or reuses) and upserts the vectors for chunks [from, to) of one
 * document. Idempotent: the vector ids are fixed by the chunk rows, so a replay
 * writes the same ids again. With no index or no model bound nothing is
 * written and the caller records a keyword-only draft.
 */
export async function embedChunkRange(
  ctx: IndexContext,
  input: {
    generationId: string;
    documentId: string;
    from: number;
    to: number;
    reuseFromGenerationId: string | null;
    now?: number;
  },
): Promise<{ embedded: number; reused: number; skipped: number }> {
  const now = input.now ?? Date.now();
  const rows = (
    await ctx.db
      .prepare(
        `SELECT chunk_id, vector_id, content, content_digest, acl_group FROM chunks
         WHERE generation_id = ? AND document_id = ? AND chunk_index >= ? AND chunk_index < ?
         ORDER BY chunk_index`,
      )
      .bind(input.generationId, input.documentId, input.from, input.to)
      .all<StoredChunk>()
  ).results;
  if (!ctx.vectors || !ctx.ai) {
    return { embedded: 0, reused: 0, skipped: rows.length };
  }
  const reusable = await reusableVectors(ctx, input.reuseFromGenerationId, rows);
  const namespace = await generationNamespace(input.generationId);
  const values = new Map<string, number[]>();
  const toEmbed: StoredChunk[] = [];
  for (const row of rows) {
    const reused = reusable.get(row.content_digest);
    if (reused) {
      values.set(row.chunk_id, reused);
    } else {
      toEmbed.push(row);
    }
  }
  for (let index = 0; index < toEmbed.length; index += EMBED_BATCH) {
    const slice = toEmbed.slice(index, index + EMBED_BATCH);
    const embeddings = await embedWithWorkersAi(ctx.ai, EMBEDDING_MODEL, {
      kind: "documents",
      texts: slice.map((row) => row.content),
    });
    for (const [offset, embedding] of embeddings.entries()) {
      values.set(slice[offset].chunk_id, embedding);
    }
  }
  const records: VectorRecord[] = rows.map((row) => ({
    id: row.vector_id,
    values: values.get(row.chunk_id)!,
    namespace,
    metadata: { acl_group: row.acl_group },
  }));
  for (let index = 0; index < records.length; index += VECTOR_UPSERT_LIMIT) {
    const result = await ctx.vectors.upsert(records.slice(index, index + VECTOR_UPSERT_LIMIT));
    const recorded = await recordMutation(ctx.db, input.generationId, result, now);
    if (!recorded) {
      throw new Error("Vectorize returned no mutation identifier for an upsert");
    }
  }
  return { embedded: toEmbed.length, reused: rows.length - toEmbed.length, skipped: 0 };
}

/** Writes the catalog row (and the body when given) once a document's chunks exist. */
export async function finalizeDocument(
  ctx: IndexContext,
  input: {
    generationId: string;
    doc: DocumentToIndex;
    body: string | null;
    department: string | null;
    now?: number;
  },
): Promise<{ chunkCount: number }> {
  const now = input.now ?? Date.now();
  const { db } = ctx;
  const chunks = await db
    .prepare(`SELECT heading FROM chunks WHERE generation_id = ? AND document_id = ? ORDER BY chunk_index`)
    .bind(input.generationId, input.doc.documentId)
    .all<{ heading: string }>();
  const headings = [...new Set(chunks.results.map((row) => row.heading).filter(Boolean))];
  const statements = [
    db.prepare(UPSERT_CATALOG_SQL).bind(
      input.doc.documentId,
      input.generationId,
      input.doc.title,
      input.department,
      typeof input.doc.metadata.version === "string" ? input.doc.metadata.version : null,
      typeof input.doc.metadata.effective_date === "string" ? input.doc.metadata.effective_date : null,
      JSON.stringify(headings),
      input.doc.accessScope,
      JSON.stringify(input.doc.allowedRoles),
      JSON.stringify(input.doc.allowedDepartments),
      JSON.stringify({
        ...input.doc.metadata,
        owner_user_id: ownerOfMetadata(input.doc.metadata),
        title: input.doc.title,
        source_name: input.doc.sourceName,
      }),
      chunks.results.length,
      fileNameOf(input.doc.sourcePath),
      now,
    ),
  ];
  if (input.body !== null) {
    statements.push(
      db.prepare(UPSERT_BODY_SQL).bind(input.doc.documentId, input.generationId, input.body, 0),
    );
  }
  await db.batch(statements);
  return { chunkCount: chunks.results.length };
}

/**
 * Catalog, bodies and version rows of every base document (or just one, when
 * `documentId` is given), copied in one atomic batch.
 */
export async function copyBaseDocuments(
  db: SqlExecutor,
  input: { draftGenerationId: string; baseGenerationId: string; documentId?: string },
): Promise<void> {
  const tag = (await sha256Hex(input.draftGenerationId)).slice(0, 8);
  const only = input.documentId === undefined ? "" : " AND document_id = ?";
  const scope = input.documentId === undefined ? [] : [input.documentId];
  await db.batch([
    db
      .prepare(
        `INSERT INTO document_catalog (
           document_id, generation_id, title, department, version, effective_date, headings_json,
           access_scope, allowed_roles, allowed_departments, metadata, chunk_count, file_name, updated_at
         )
         SELECT document_id, ?, title, department, version, effective_date, headings_json,
           access_scope, allowed_roles, allowed_departments, metadata, chunk_count, file_name, updated_at
         FROM document_catalog WHERE generation_id = ?${only} AND true
         ON CONFLICT(document_id, generation_id) DO NOTHING`,
      )
      .bind(input.draftGenerationId, input.baseGenerationId, ...scope),
    db
      .prepare(
        `INSERT INTO document_bodies (document_id, generation_id, body, reconstructed)
         SELECT document_id, ?, body, reconstructed FROM document_bodies WHERE generation_id = ?${only} AND true
         ON CONFLICT(document_id, generation_id) DO NOTHING`,
      )
      .bind(input.draftGenerationId, input.baseGenerationId, ...scope),
    db
      .prepare(
        `INSERT INTO document_versions (
           id, document_id, generation_id, r2_key, content_digest, byte_size, created_at
         )
         SELECT id || '-' || ?, document_id, ?, r2_key, content_digest, byte_size, created_at
         FROM document_versions WHERE generation_id = ?${only} AND true
         ON CONFLICT(document_id, generation_id) DO NOTHING`,
      )
      .bind(tag, input.draftGenerationId, input.baseGenerationId, ...scope),
  ]);
}

/**
 * Removes everything the draft holds for one document: its vectors (recorded
 * as index mutations so reconciliation waits for them), chunks, catalog, body
 * and version rows. Idempotent.
 */
export async function removeDocumentFromDraft(
  ctx: IndexContext,
  input: { generationId: string; documentId: string; now?: number },
): Promise<void> {
  const now = input.now ?? Date.now();
  const { db } = ctx;
  const old = await db
    .prepare(`SELECT vector_id FROM chunks WHERE generation_id = ? AND document_id = ?`)
    .bind(input.generationId, input.documentId)
    .all<{ vector_id: string }>();
  await deleteVectors(ctx, input.generationId, old.results.map((row) => row.vector_id), now);
  await db.batch([
    db.prepare(`DELETE FROM chunks WHERE generation_id = ? AND document_id = ?`).bind(input.generationId, input.documentId),
    db.prepare(`DELETE FROM document_catalog WHERE generation_id = ? AND document_id = ?`).bind(input.generationId, input.documentId),
    db.prepare(`DELETE FROM document_bodies WHERE generation_id = ? AND document_id = ?`).bind(input.generationId, input.documentId),
    db.prepare(`DELETE FROM document_versions WHERE generation_id = ? AND document_id = ?`).bind(input.generationId, input.documentId),
  ]);
}

/**
 * How long after a draft closed a workflow step that started before the close
 * may still be running. Ingestion steps time out after 10 minutes; this is
 * three times that. Until it has passed, a discarded draft's vector ids are
 * kept, because such a step may still upsert one of them.
 */
export const DISCARD_GRACE_MS = 30 * 60 * 1000;
/** Pages of VECTOR_DELETE_LIMIT ids one purge pass deletes after the grace window. */
const PURGE_VECTOR_PAGES = 50;

const DISCARDED_DRAFT = `SELECT 1 FROM drafts d JOIN corpus_generations g ON g.id = d.generation_id
  WHERE d.generation_id = ? AND d.closed_at IS NOT NULL AND g.state = 'failed' AND g.error_code = 'DISCARDED'`;

/**
 * Empties a discarded draft. Idempotent and safe to repeat from any caller (the
 * discard route, then the scheduled purge). A generation that is not a
 * discarded draft is never touched.
 *
 * 1. In one atomic batch, every vector id the draft's chunks name is kept as a
 *    tombstone and its chunks, catalog, bodies and versions are deleted. The
 *    write fence in the corpus schema refuses any row a late step tries to add.
 * 2. With `deleteVectorsNow` (the discard route) the tombstoned vectors are
 *    deleted at once, so the index does not hold them for the grace window.
 * 3. Once DISCARD_GRACE_MS has passed since the draft closed, no step that
 *    read rows before the discard can still upsert: every tombstoned vector is
 *    deleted again, the tombstones go, and the draft is marked purged. This
 *    pass is bounded; `purged: false` means call again.
 */
export async function purgeDiscardedDraft(
  ctx: IndexContext,
  generationId: string,
  options: { now?: number; deleteVectorsNow?: boolean } = {},
): Promise<{ purged: boolean }> {
  const now = options.now ?? Date.now();
  const { db } = ctx;
  const draft = await db
    .prepare(`SELECT d.closed_at, d.purged_at FROM drafts d JOIN corpus_generations g ON g.id = d.generation_id
       WHERE d.generation_id = ? AND d.closed_at IS NOT NULL AND g.state = 'failed' AND g.error_code = 'DISCARDED'`)
    .bind(generationId)
    .first<{ closed_at: number; purged_at: number | null }>();
  if (!draft) {
    return { purged: false };
  }
  if (draft.purged_at !== null) {
    return { purged: true };
  }
  const discarded = `AND EXISTS (${DISCARDED_DRAFT})`;
  await db.batch([
    db
      .prepare(
        `INSERT INTO discarded_vectors (generation_id, vector_id)
         SELECT generation_id, vector_id FROM chunks WHERE generation_id = ? ${discarded}
         ON CONFLICT (generation_id, vector_id) DO NOTHING`,
      )
      .bind(generationId, generationId),
    db.prepare(`DELETE FROM chunks WHERE generation_id = ? ${discarded}`).bind(generationId, generationId),
    db.prepare(`DELETE FROM document_catalog WHERE generation_id = ? ${discarded}`).bind(generationId, generationId),
    db.prepare(`DELETE FROM document_bodies WHERE generation_id = ? ${discarded}`).bind(generationId, generationId),
    db.prepare(`DELETE FROM document_versions WHERE generation_id = ? ${discarded}`).bind(generationId, generationId),
  ]);
  const tombstones = (afterId: string) =>
    db
      .prepare(
        `SELECT vector_id FROM discarded_vectors WHERE generation_id = ? AND vector_id > ?
         ORDER BY vector_id LIMIT ?`,
      )
      .bind(generationId, afterId, VECTOR_DELETE_LIMIT)
      .all<{ vector_id: string }>();
  if (now < draft.closed_at + DISCARD_GRACE_MS) {
    if (options.deleteVectorsNow) {
      let after = "";
      for (;;) {
        const ids = (await tombstones(after)).results.map((row) => row.vector_id);
        if (ids.length === 0) {
          break;
        }
        await deleteVectors(ctx, generationId, ids, now);
        after = ids[ids.length - 1];
      }
    }
    return { purged: false };
  }
  for (let page = 0; page < PURGE_VECTOR_PAGES; page += 1) {
    const ids = (await tombstones("")).results.map((row) => row.vector_id);
    if (ids.length === 0) {
      await db
        .prepare(`UPDATE drafts SET purged_at = ? WHERE generation_id = ? AND purged_at IS NULL`)
        .bind(now, generationId)
        .run();
      return { purged: true };
    }
    await deleteVectors(ctx, generationId, ids, now);
    await db
      .prepare(
        `DELETE FROM discarded_vectors WHERE generation_id = ? AND vector_id IN (${ids.map(() => "?").join(", ")})`,
      )
      .bind(generationId, ...ids)
      .run();
  }
  return { purged: false };
}

type BaseChunkRow = {
  id: number;
  chunk_id: string;
  document_id: string;
  document_version_id: string;
  heading: string;
  chunk_index: number;
  content: string;
  start_offset: number;
  end_offset: number;
  content_digest: string;
  vector_id: string;
  acl_group: string;
  access_scope: string;
  allowed_roles: string;
  allowed_departments: string;
  metadata: string;
};

/**
 * Copies one page of base chunks into the draft: new chunk and vector ids. When
 * the base was embedded by the current model its vectors are reused through
 * getByIds; when it was not, the chunks are embedded again (or, with no model
 * to do that, the copy fails explicitly). Never mixes embedding spaces.
 * Returns the cursor for the next page, or null when the base is exhausted.
 * `documentId` limits the copy to one document.
 */
export async function copyBaseChunkPage(
  ctx: IndexContext,
  input: {
    draftGenerationId: string;
    baseGenerationId: string;
    afterId: number;
    documentId?: string;
    now?: number;
  },
): Promise<{ nextAfterId: number | null; copied: number; baseVectorsMissing: number }> {
  const now = input.now ?? Date.now();
  const { db } = ctx;
  const only = input.documentId === undefined ? "" : " AND document_id = ?";
  const scope = input.documentId === undefined ? [] : [input.documentId];
  const page = (
    await db
      .prepare(`SELECT * FROM chunks WHERE generation_id = ? AND id > ?${only} ORDER BY id LIMIT ?`)
      .bind(input.baseGenerationId, input.afterId, ...scope, COPY_PAGE)
      .all<BaseChunkRow>()
  ).results;
  if (page.length === 0) {
    return { nextAfterId: null, copied: 0, baseVectorsMissing: 0 };
  }
  const reuse = ctx.vectors ? await embeddingsReusableFrom(db, input.baseGenerationId) : true;
  if (ctx.vectors && !reuse && !ctx.ai) {
    // Fail before any row is written: the draft cannot be built without a model.
    throw new UploadFailure("INDEX_UNAVAILABLE");
  }
  const tag = (await sha256Hex(input.draftGenerationId)).slice(0, 8);
  const baseSuffix = `--${input.baseGenerationId}`;
  const moved: Array<{ row: BaseChunkRow; chunkId: string; vectorId: string }> = [];
  const statements: Array<ReturnType<SqlExecutor["prepare"]>> = [];
  for (const row of page) {
    const stem = row.chunk_id.endsWith(baseSuffix) ? row.chunk_id.slice(0, -baseSuffix.length) : row.chunk_id;
    const chunkId = `${stem}--${input.draftGenerationId}`;
    const vectorId = await vectorIdForChunk(chunkId);
    moved.push({ row, chunkId, vectorId });
    statements.push(
      db.prepare(UPSERT_CHUNK_SQL).bind(
        chunkId,
        row.document_id,
        `${row.document_version_id}-${tag}`,
        input.draftGenerationId,
        row.heading,
        row.chunk_index,
        row.content,
        row.start_offset,
        row.end_offset,
        row.content_digest,
        vectorId,
        row.acl_group,
        row.access_scope,
        row.allowed_roles,
        row.allowed_departments,
        row.metadata,
        now,
      ),
    );
  }
  await db.batch(statements);
  let missing = 0;
  if (ctx.vectors) {
    const namespace = await generationNamespace(input.draftGenerationId);
    const valuesById = new Map<string, number[]>();
    if (reuse) {
      for (const batch of chunksOf(
        moved.map((entry) => entry.row.vector_id),
        VECTOR_GET_LIMIT,
      )) {
        for (const vector of await ctx.vectors.getByIds(batch)) {
          if (vector.values && vector.values.length === EMBEDDING_DIMENSIONS) {
            valuesById.set(vector.id, Array.from(vector.values));
          }
        }
      }
    } else {
      for (let index = 0; index < moved.length; index += EMBED_BATCH) {
        const slice = moved.slice(index, index + EMBED_BATCH);
        const embeddings = await embedWithWorkersAi(ctx.ai!, EMBEDDING_MODEL, {
          kind: "documents",
          texts: slice.map((entry) => entry.row.content),
        });
        for (const [offset, embedding] of embeddings.entries()) {
          valuesById.set(slice[offset].row.vector_id, embedding);
        }
      }
    }
    const records: VectorRecord[] = [];
    for (const entry of moved) {
      const values = valuesById.get(entry.row.vector_id);
      if (!values) {
        missing += 1;
        continue;
      }
      records.push({
        id: entry.vectorId,
        values,
        namespace,
        metadata: { acl_group: entry.row.acl_group },
      });
    }
    for (let index = 0; index < records.length; index += VECTOR_UPSERT_LIMIT) {
      const result = await ctx.vectors.upsert(records.slice(index, index + VECTOR_UPSERT_LIMIT));
      if (!(await recordMutation(db, input.draftGenerationId, result, now))) {
        throw new Error("Vectorize returned no mutation identifier for an upsert");
      }
    }
  }
  return {
    nextAfterId: page.length < COPY_PAGE ? null : page[page.length - 1].id,
    copied: page.length,
    baseVectorsMissing: missing,
  };
}
