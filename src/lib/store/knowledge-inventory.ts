import type { DocumentChunk, KnowledgeDocument } from "../rag/types";
import { emptyEmbeddingStorageStatus, type EmbeddingStorageStatus } from "../rag/storage-records";
import type { SqlExecutor } from "./corpus-d1";
import { activeGenerationId, getGeneration } from "./corpus-d1";
import { canAccessChunk, type Principal } from "../acl/access";

type DocumentRow = {
  id: string;
  path: string;
};

type ChunkRow = {
  chunk_id: string;
  document_id: string;
  heading: string;
  content: string;
  created_at: number;
  access_scope: string;
  allowed_roles: string;
  allowed_departments: string;
  metadata: string;
};

type CountRow = {
  n: number;
};

export type KnowledgeInventory = {
  documents: KnowledgeDocument[];
  chunks: DocumentChunk[];
  embeddingStorageStatus: EmbeddingStorageStatus;
  retrievalMode: "hybrid" | "keyword";
};

function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function parseStoredList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

export async function loadKnowledgeInventory(
  db: SqlExecutor,
  retrievalMode: KnowledgeInventory["retrievalMode"],
  principal?: Principal,
): Promise<KnowledgeInventory> {
  const activeId = await activeGenerationId(db);
  const ready = await db
    .prepare(
      `SELECT id FROM corpus_generations WHERE state = 'ready' ORDER BY updated_at DESC LIMIT 1`,
    )
    .first<{ id: string }>();
  const generationId = ready?.id ?? activeId ?? null;
  if (!generationId) {
    return {
      documents: [],
      chunks: [],
      embeddingStorageStatus: {
        ...emptyEmbeddingStorageStatus,
        corpusStatus: "not_started",
      },
      retrievalMode,
    };
  }
  const generation = await getGeneration(db, generationId);
  const documents = await db
    .prepare(
      `SELECT DISTINCT d.id, d.path
       FROM documents d
       JOIN chunks c ON c.document_id = d.id
       WHERE c.generation_id = ?
       ORDER BY d.path`,
    )
    .bind(generationId)
    .all<DocumentRow>();
  const chunks = await db
    .prepare(
      `SELECT chunk_id, document_id, heading, content, created_at,
              access_scope, allowed_roles, allowed_departments, metadata
       FROM chunks WHERE generation_id = ? ORDER BY document_id, chunk_index`,
    )
    .bind(generationId)
    .all<ChunkRow>();
  const storedDocuments = await db
    .prepare(
      `SELECT COUNT(DISTINCT d.id) AS n
       FROM documents d
       JOIN chunks c ON c.document_id = d.id
       WHERE c.generation_id = ?`,
    )
    .bind(generationId)
    .first<CountRow>();
  const storedChunks = await db
    .prepare(`SELECT COUNT(*) AS n FROM chunks WHERE generation_id = ?`)
    .bind(generationId)
    .first<CountRow>();
  const visibleDocumentIds = new Set<string>();
  for (const chunk of chunks.results) {
    if (!principal) {
      visibleDocumentIds.add(chunk.document_id);
      continue;
    }
    const allowed = canAccessChunk(principal, {
      accessScope: chunk.access_scope,
      allowedRoles: parseStoredList(chunk.allowed_roles),
      allowedDepartments: parseStoredList(chunk.allowed_departments),
      metadata: parseMetadata(chunk.metadata),
    }).allowed;
    if (allowed) {
      visibleDocumentIds.add(chunk.document_id);
    }
  }
  const visibleDocuments = documents.results.filter((row) => visibleDocumentIds.has(row.id));
  const visibleChunks = chunks.results.filter((row) => visibleDocumentIds.has(row.document_id));
  const textByDocument = new Map<string, string[]>();
  for (const chunk of visibleChunks) {
    const list = textByDocument.get(chunk.document_id) ?? [];
    list.push(chunk.content);
    textByDocument.set(chunk.document_id, list);
  }
  const knowledgeDocuments: KnowledgeDocument[] = visibleDocuments.map((row) => ({
    id: row.id,
    source: fileName(row.path),
    title: fileName(row.path).replace(/\.md$/i, "").replace(/-/g, " "),
    text: (textByDocument.get(row.id) ?? []).join("\n\n"),
  }));
  const knowledgeChunks: DocumentChunk[] = visibleChunks.map((row) => ({
    id: row.chunk_id,
    source: fileName(visibleDocuments.find((doc) => doc.id === row.document_id)?.path ?? row.document_id),
    section: row.heading,
    text: row.content,
    tokenEstimate: Math.max(1, Math.ceil(row.content.length / 4)),
    createdAt: new Date(row.created_at).toISOString(),
  }));
  return {
    documents: knowledgeDocuments,
    chunks: knowledgeChunks,
    embeddingStorageStatus: {
      storedDocuments: storedDocuments?.n ?? knowledgeDocuments.length,
      storedChunks: storedChunks?.n ?? knowledgeChunks.length,
      embeddedChunks: storedChunks?.n ?? knowledgeChunks.length,
      lastRunStatus: "succeeded",
      lastRunMessage: null,
      lastEmbeddedAt: Date.now(),
      activeVersionId: activeId,
      readyVersionId: ready?.id ?? null,
      corpusStatus:
        generation?.state === "active" ? "active" : generation?.state === "ready" ? "ready" : "processing",
    },
    retrievalMode,
  };
}
