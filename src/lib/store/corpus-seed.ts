import type { AccessScope } from "../acl/acl-group";
import { aclGroupKey } from "../acl/acl-group";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../embeddings/instructions";
import { embedWithWorkersAi, type WorkersAiRunner } from "../embeddings/workers-ai-embed";
import { chunkDocument } from "../ingest/chunker";
import { contentDigest, generationNamespace, vectorIdForChunk } from "../ingest/digests";
import { REAL_STACK_FINGERPRINT } from "../retrieve/fingerprint";
import type { VectorizeIndex } from "../retrieve/cloudflare-pipeline";
import { auditStoreConsistency } from "./inventory-audit";
import {
  activeGenerationId,
  ensureDraftGeneration,
  ensureGenerationState,
  recordAudit,
  type SqlExecutor,
} from "./corpus-d1";
import { canMarkReady, UPSERT_CHUNK_SQL } from "./generations";
import { newBoundedId } from "./conversations";

export type SeedDocumentInput = {
  documentId: string;
  title: string;
  sourceName: string;
  sourcePath: string;
  accessScope: AccessScope;
  allowedRoles: string[];
  allowedDepartments: string[];
  body: string;
  metadata?: Record<string, unknown>;
};

const NORTHWIND_SOURCE_ID = "src-northwind";
const EMBED_BATCH = 8;
const UPSERT_BATCH = 20;

export async function seedNorthwindCorpus(input: {
  db: SqlExecutor;
  documents: SeedDocumentInput[];
  ai?: WorkersAiRunner;
  vectorize?: VectorizeIndex;
  now?: number;
}): Promise<{ generationId: string; chunkCount: number; vectorize: "upserted" | "skipped" }> {
  if (input.documents.length === 0) {
    throw new Error("seed requires at least one document");
  }
  const now = input.now ?? Date.now();
  const generationId = newBoundedId("g");
  await ensureDraftGeneration(input.db, generationId, now);
  await input.db
    .prepare(
      `INSERT INTO sources (id, kind, display_name, config_json, created_at)
       VALUES (?, 'upload', 'Northwind', '{}', ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(NORTHWIND_SOURCE_ID, now)
    .run();

  const namespace = await generationNamespace(generationId);
  const expected: Record<string, string> = {};
  const vectors: Array<{
    id: string;
    values: number[];
    namespace: string;
    metadata: Record<string, string>;
  }> = [];
  const embedTexts: string[] = [];
  const pending: Array<{
    chunkId: string;
    vectorId: string;
    aclGroup: string;
  }> = [];

  await ensureGenerationState(input.db, generationId, "indexing", now);

  for (const document of input.documents) {
    await input.db
      .prepare(
        `INSERT INTO documents (id, source_id, path, access_scope, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET path = excluded.path, access_scope = excluded.access_scope`,
      )
      .bind(document.documentId, NORTHWIND_SOURCE_ID, document.sourcePath, document.accessScope, now)
      .run();
    const versionId = `dv-${(await contentDigest(`${document.documentId}:${generationId}`)).slice(0, 40)}`;
    const digest = await contentDigest(document.body);
    await input.db
      .prepare(
        `INSERT INTO document_versions (
           id, document_id, generation_id, r2_key, content_digest, byte_size, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(document_id, generation_id) DO NOTHING`,
      )
      .bind(
        versionId,
        document.documentId,
        generationId,
        `corpus/${generationId}/${document.documentId}.md`,
        digest,
        document.body.length,
        now,
      )
      .run();
    const chunks = chunkDocument(
      { documentId: document.documentId, content: document.body },
      {
        maxTokens: REAL_STACK_FINGERPRINT.maxTokens,
        overlapTokens: REAL_STACK_FINGERPRINT.overlapTokens,
      },
    );
    const ownerUserId =
      typeof document.metadata?.owner_user_id === "string" ? document.metadata.owner_user_id : "";
    const aclGroup = await aclGroupKey({
      accessScope: document.accessScope,
      allowedRoles: document.allowedRoles,
      allowedDepartments: document.allowedDepartments,
      ownerUserId,
    });
    const metadata = JSON.stringify({
      ...(document.metadata ?? {}),
      owner_user_id: ownerUserId,
      title: document.title,
      source_name: document.sourceName,
    });
    const chunkWrites: Array<ReturnType<SqlExecutor["prepare"]>> = [];
    for (const chunk of chunks) {
      const storedChunkId = `${chunk.chunkId}--${generationId}`;
      const vectorId = await vectorIdForChunk(storedChunkId);
      const chunkDigest = await contentDigest(chunk.content);
      chunkWrites.push(
        input.db.prepare(UPSERT_CHUNK_SQL).bind(
          storedChunkId,
          document.documentId,
          versionId,
          generationId,
          chunk.sectionHeading,
          chunk.chunkIndex,
          chunk.content,
          chunk.charStart,
          chunk.charEnd,
          chunkDigest,
          vectorId,
          aclGroup,
          document.accessScope,
          JSON.stringify(document.allowedRoles),
          JSON.stringify(document.allowedDepartments),
          metadata,
          now,
        ),
      );
      expected[vectorId] = storedChunkId;
      embedTexts.push(chunk.content);
      pending.push({ chunkId: storedChunkId, vectorId, aclGroup });
      if (chunkWrites.length >= UPSERT_BATCH) {
        await input.db.batch(chunkWrites.splice(0, chunkWrites.length));
      }
    }
    if (chunkWrites.length > 0) {
      await input.db.batch(chunkWrites);
    }
  }

  let vectorizeStatus: "upserted" | "skipped" = "skipped";
  const mutationIds: string[] = [];
  if (input.ai && input.vectorize?.upsert && pending.length > 0) {
    try {
      for (let index = 0; index < pending.length; index += EMBED_BATCH) {
        const slice = embedTexts.slice(index, index + EMBED_BATCH);
        const embeddings = await embedWithWorkersAi(input.ai, EMBEDDING_MODEL, {
          kind: "documents",
          texts: slice,
        });
        for (const [offset, embedding] of embeddings.entries()) {
          const item = pending[index + offset];
          vectors.push({
            id: item.vectorId,
            values: embedding,
            namespace,
            metadata: { acl_group: item.aclGroup },
          });
        }
      }
      if (input.vectorize?.upsert && vectors.length > 0) {
        for (let index = 0; index < vectors.length; index += UPSERT_BATCH) {
          const result = await input.vectorize.upsert(vectors.slice(index, index + UPSERT_BATCH));
          if (result && typeof result.mutationId === "string" && result.mutationId) {
            mutationIds.push(result.mutationId);
          }
        }
        if (mutationIds.length === 0) {
          throw new Error("Vectorize returned no mutation identifier for the seeded generation");
        }
        vectorizeStatus = "upserted";
      }
    } catch (error) {
      await ensureGenerationState(input.db, generationId, "failed", now);
      throw error;
    }
  }

  await ensureGenerationState(input.db, generationId, "reconciling", now);

  const watermark = mutationIds[mutationIds.length - 1] ?? `seed-${generationId}`;
  if (mutationIds.length > 0) {
    for (const mutationId of mutationIds) {
      await input.db
        .prepare(
          `INSERT INTO vector_mutations (generation_id, mutation_id, recorded_at)
           VALUES (?, ?, ?)
           ON CONFLICT(generation_id, mutation_id) DO NOTHING`,
        )
        .bind(generationId, mutationId, now)
        .run();
    }
  } else {
    await input.db
      .prepare(
        `INSERT INTO vector_mutations (generation_id, mutation_id, recorded_at)
         VALUES (?, ?, ?)
         ON CONFLICT(generation_id, mutation_id) DO NOTHING`,
      )
      .bind(generationId, watermark, now)
      .run();
  }

  const actualIds = Object.keys(expected);
  const report = auditStoreConsistency({
    inventoryWatermark: () => watermark,
    expectedVectorIds: () => expected,
    vectorIds: () => actualIds,
  });
  await recordAudit(input.db, generationId, report, now);
  await input.db
    .prepare(`UPDATE corpus_generations SET metadata_index_ready = 1, updated_at = ? WHERE id = ?`)
    .bind(now, generationId)
    .run();
  canMarkReady({
    auditStatus: report.status,
    auditClean: report.clean,
    metadataIndexReady: true,
    dimensions: EMBEDDING_DIMENSIONS,
    expectedDimensions: EMBEDDING_DIMENSIONS,
  });
  await ensureGenerationState(input.db, generationId, "ready", now);
  return { generationId, chunkCount: pending.length, vectorize: vectorizeStatus };
}

const ACCESS_SCOPES = new Set<AccessScope>(["public", "role", "department", "private"]);

type StoredSeedChunk = {
  document_id: string;
  path: string;
  content: string;
  chunk_index: number;
  access_scope: string;
  allowed_roles: string;
  allowed_departments: string;
  metadata: string;
};

export function mergeSeedDocuments(
  existing: SeedDocumentInput[],
  incoming: SeedDocumentInput[],
): SeedDocumentInput[] {
  const byId = new Map(existing.map((document) => [document.documentId, document]));
  for (const document of incoming) {
    byId.set(document.documentId, document);
  }
  return [...byId.values()];
}

export function removeSeedDocument(
  existing: SeedDocumentInput[],
  documentId: string,
): SeedDocumentInput[] {
  return existing.filter((document) => document.documentId !== documentId);
}

export async function latestReadyOrActiveGenerationId(db: SqlExecutor): Promise<string | null> {
  const ready = await db
    .prepare(
      `SELECT id FROM corpus_generations WHERE state = 'ready' ORDER BY updated_at DESC LIMIT 1`,
    )
    .first<{ id: string }>();
  return ready?.id ?? activeGenerationId(db);
}

export async function loadSeedDocumentsFromGeneration(
  db: SqlExecutor,
  generationId: string,
): Promise<SeedDocumentInput[]> {
  const rows = await db
    .prepare(
      `SELECT c.document_id, d.path, c.content, c.chunk_index, c.access_scope,
              c.allowed_roles, c.allowed_departments, c.metadata
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.generation_id = ?
       ORDER BY c.document_id, c.chunk_index`,
    )
    .bind(generationId)
    .all<StoredSeedChunk>();
  const grouped = new Map<string, StoredSeedChunk[]>();
  for (const row of rows.results) {
    const list = grouped.get(row.document_id) ?? [];
    list.push(row);
    grouped.set(row.document_id, list);
  }
  const documents: SeedDocumentInput[] = [];
  for (const [documentId, chunks] of grouped) {
    const first = chunks[0];
    if (!ACCESS_SCOPES.has(first.access_scope as AccessScope)) {
      throw new Error(`stored document ${documentId} is missing ACL metadata`);
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
    const file = first.path.split("/").pop() ?? first.path;
    documents.push({
      documentId,
      title: typeof metadata.title === "string" ? metadata.title : file.replace(/\.md$/i, ""),
      sourceName: typeof metadata.source_name === "string" ? metadata.source_name : first.path,
      sourcePath: first.path,
      accessScope: first.access_scope as AccessScope,
      allowedRoles: parseStoredList(first.allowed_roles),
      allowedDepartments: parseStoredList(first.allowed_departments),
      body: chunks.map((chunk) => chunk.content).join("\n\n"),
      metadata,
    });
  }
  return documents;
}

function parseStoredList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
