import {
  aclFilterFor,
  aclSqlAndParams,
  enumerateAllowedAclGroups,
  filterChunks,
  fts5MatchQuery,
  ftsCandidateFetchLimit,
  keywordSearchSql,
  principalHasFullDocumentAccess,
  type Principal,
} from "../acl/access";
import { EMBEDDING_MODEL } from "../embeddings/instructions";
import { embedWithWorkersAi, type WorkersAiRunner } from "../embeddings/workers-ai-embed";
import { buildVectorizeQuery } from "./cloudflare-query";
import { REAL_STACK_FINGERPRINT, fingerprintId, type RetrievalFingerprint } from "./fingerprint";
import { fuseCandidates, selectRerankHead, simpleRerank } from "./fusion";
import { queryLooksLiteral, rescoreLocally } from "./keyword-score";
import { applyRelevanceFloor, rerankWithHeading, type Reranker } from "./rerank";
import { expandParent } from "./parent-off";
import type { ChunkRecord, SearchHit, SearchResponse, ScoredChunk } from "./types";
import { VECTORIZE_METADATA_INDEX } from "../store/vectorize-projection";

export type CorpusSql = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results: T[] }>;
      first<T>(): Promise<T | null>;
    };
  };
};

export type VectorizeIndex = {
  query(
    vector: number[],
    options: {
      topK: number;
      namespace: string;
      filter: Record<string, unknown>;
      returnMetadata?: "none" | "indexed" | "all";
    },
  ): Promise<{ matches: Array<{ id: string; score: number }> }>;
  upsert?(
    vectors: Array<{
      id: string;
      values: number[];
      namespace?: string;
      metadata?: Record<string, string>;
    }>,
  ): Promise<{ mutationId?: string } | void>;
};

type ChunkRow = {
  chunk_id: string;
  document_id: string;
  heading: string;
  content: string;
  chunk_index: number;
  start_offset: number;
  end_offset: number;
  access_scope: string;
  allowed_roles: string;
  allowed_departments: string;
  metadata: string;
  path: string | null;
};

export class CloudflareKnowledgePipeline {
  constructor(
    private readonly input: {
      db: CorpusSql;
      vectorize: VectorizeIndex | null;
      ai: WorkersAiRunner;
      reranker: Reranker;
      generationId: string;
      fingerprint?: RetrievalFingerprint;
    },
  ) {}

  async search(input: {
    query: string;
    principal: Principal;
    topK?: number;
    candidateLimit?: number;
  }): Promise<SearchResponse> {
    const fingerprint: RetrievalFingerprint = this.input.fingerprint ?? REAL_STACK_FINGERPRINT;
    const topK = Math.max(1, Math.min(input.topK ?? 8, 50));
    const candidateLimit = Math.max(1, Math.min(input.candidateLimit ?? 24, 200));
    const fetchLimit = Math.max(candidateLimit, topK);
    const query = input.query.slice(0, 4096);
    const acl = aclFilterFor(input.principal);
    const generationId = this.input.generationId;
    const shapes = await loadAclShapes(this.input.db, generationId);
    const aclKeys = await enumerateAllowedAclGroups(acl, shapes);
    // The vector channel degrades to keyword-only on embedding or Vectorize
    // transport failures. The degradation is recorded on the trace, never
    // hidden: one Vectorize internal error must not blank out the keyword
    // channel that still finds exact-token matches under the same ACL
    // constraints. Fail-closed policy errors (missing namespace or ACL
    // filter, over-wide serialized filter) are raised before the try and
    // always propagate.
    let vectorChannelError = false;
    const vectorMatches: Array<{ vectorId: string; score: number }> = [];
    if (this.input.vectorize && aclKeys.length > 0) {
      const vectorQuery = await buildVectorizeQuery({ generationId, aclGroupKeys: aclKeys });
      try {
        const queryEmbedding = await embedWithWorkersAi(this.input.ai, EMBEDDING_MODEL, {
          kind: "query",
          text: query,
        });
        if (queryEmbedding[0]) {
          const vectorResult = await this.input.vectorize.query(queryEmbedding[0], {
            topK: fetchLimit,
            namespace: vectorQuery.namespace,
            filter: vectorQuery.filter,
            returnMetadata: "indexed",
          });
          for (const match of vectorResult.matches ?? []) {
            vectorMatches.push({ vectorId: match.id, score: match.score });
          }
        }
      } catch {
        vectorChannelError = true;
        vectorMatches.length = 0;
      }
    }
    const vectorChunkIds = await loadVectorChunkIds(
      this.input.db,
      generationId,
      vectorMatches.map((match) => match.vectorId),
    );
    const vectorHits = vectorMatches.map((match) => {
      const chunkId = vectorChunkIds[match.vectorId];
      if (!chunkId) {
        throw new Error("Vectorize returned an ID absent from the active D1 generation");
      }
      return { chunkId, score: match.score };
    });
    const { sql, params } = aclSqlAndParams(acl);
    const match = fts5MatchQuery(query);
    const rows = await this.input.db
      .prepare(keywordSearchSql(sql))
      .bind(match, generationId, ...params, ftsCandidateFetchLimit(Math.min(fetchLimit, fingerprint.keywordCandidates)))
      .all<{ chunk_id: string }>();
    const keywordHits = rows.results.map((row) => ({ chunkId: row.chunk_id, score: 0 }));
    const candidateIds = [...new Set([...vectorHits, ...keywordHits].map((hit) => hit.chunkId))].sort();
    const loaded = await loadChunks(this.input.db, candidateIds);
    const { allowed } = filterChunks(input.principal, loaded);
    const allowedIds = new Set(allowed.map((chunk) => chunk.chunkId));
    const chunksById = Object.fromEntries(allowed.map((chunk) => [chunk.chunkId, chunk]));
    const allowedVectorHits = vectorHits.filter((hit) => allowedIds.has(hit.chunkId));
    const allowedKeywordHits = rescoreLocally(
      query,
      keywordHits.filter((hit) => allowedIds.has(hit.chunkId)),
      allowed,
    );
    const literal = queryLooksLiteral(query);
    const merged = fuseCandidates({
      vectorHits: allowedVectorHits,
      keywordHits: allowedKeywordHits,
      chunksById,
      candidateLimit: fetchLimit,
      vectorWeight: literal
        ? (fingerprint.literalVectorWeight ?? fingerprint.vectorWeight)
        : fingerprint.vectorWeight,
      keywordWeight: literal
        ? (fingerprint.literalKeywordWeight ?? fingerprint.keywordWeight)
        : fingerprint.keywordWeight,
      keywordRescue: fingerprint.keywordRescue ?? 0,
    });
    const reranked = await rerankMerged(query, merged, this.input.reranker, fingerprint);
    const final = reranked.slice(0, topK);
    const byDocument = groupByDocument(allowed);
    const hits: SearchHit[] = final.map((item) => {
      const publish = principalHasFullDocumentAccess(
        input.principal,
        byDocument.get(item.chunk.documentId) ?? [],
      );
      return {
        chunkId: item.chunk.chunkId,
        content: expandParent(item.chunk.content),
        score: item.rerankScore ?? item.mergedScore,
        citation: {
          chunkId: item.chunk.chunkId,
          documentId: item.chunk.documentId,
          sourceName: item.chunk.sourceName,
          sourcePath: item.chunk.sourcePath,
          sectionHeading: item.chunk.sectionHeading,
          charStart: publish ? item.chunk.charStart : null,
          charEnd: publish ? item.chunk.charEnd : null,
        },
      };
    });
    return {
      hits,
      trace: {
        query,
        finalChunkIds: hits.map((hit) => hit.chunkId),
        vectorScores: Object.fromEntries(
          final.flatMap((item) => (item.vectorScore === null ? [] : [[item.chunk.chunkId, item.vectorScore]])),
        ),
        keywordScores: Object.fromEntries(
          final.flatMap((item) => (item.keywordScore === null ? [] : [[item.chunk.chunkId, item.keywordScore]])),
        ),
        fusedScores: Object.fromEntries(final.map((item) => [item.chunk.chunkId, item.mergedScore])),
        rerankScores: Object.fromEntries(
          final.flatMap((item) => (item.rerankScore === null ? [] : [[item.chunk.chunkId, item.rerankScore]])),
        ),
        fingerprint: fingerprintId(fingerprint),
        ...(vectorChannelError ? { vectorChannelError: true } : {}),
      },
    };
  }
}

export async function loadAclShapes(db: CorpusSql, generationId: string) {
  const rows = await db
    .prepare(
      `SELECT DISTINCT access_scope, allowed_roles, allowed_departments, metadata
       FROM chunks WHERE generation_id = ?`,
    )
    .bind(generationId)
    .all<{
      access_scope: string;
      allowed_roles: string;
      allowed_departments: string;
      metadata: string;
    }>();
  return rows.results.map((row) => ({
    accessScope: row.access_scope as "public" | "department" | "role" | "private",
    allowedRoles: parseJsonStringArray(row.allowed_roles),
    allowedDepartments: parseJsonStringArray(row.allowed_departments),
    ownerUserId: ownerFromMetadata(row.metadata),
  }));
}

export async function loadChunks(db: CorpusSql, chunkIds: string[]): Promise<ChunkRecord[]> {
  if (chunkIds.length === 0) {
    return [];
  }
  const placeholders = chunkIds.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT c.chunk_id, c.document_id, c.heading, c.content, c.chunk_index, c.start_offset, c.end_offset,
              c.access_scope, c.allowed_roles, c.allowed_departments, c.metadata, d.path
       FROM chunks c
       LEFT JOIN documents d ON d.id = c.document_id
       WHERE c.chunk_id IN (${placeholders})`,
    )
    .bind(...chunkIds)
    .all<ChunkRow>();
  return rows.results.map(rowToChunk);
}

async function loadVectorChunkIds(
  db: CorpusSql,
  generationId: string,
  vectorIds: string[],
): Promise<Record<string, string>> {
  if (vectorIds.length === 0) {
    return {};
  }
  const placeholders = vectorIds.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT vector_id, chunk_id FROM chunks
       WHERE generation_id = ? AND vector_id IN (${placeholders})`,
    )
    .bind(generationId, ...vectorIds)
    .all<{ vector_id: string; chunk_id: string }>();
  return Object.fromEntries(rows.results.map((row) => [row.vector_id, row.chunk_id]));
}

function rowToChunk(row: ChunkRow): ChunkRecord {
  const metadata = parseJsonObject(row.metadata);
  const path = row.path ?? row.document_id;
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    title: path,
    sourceName: path,
    sourcePath: path,
    sectionHeading: row.heading,
    content: row.content,
    chunkIndex: row.chunk_index,
    charStart: row.start_offset,
    charEnd: row.end_offset,
    accessScope: row.access_scope as ChunkRecord["accessScope"],
    allowedRoles: parseJsonStringArray(row.allowed_roles),
    allowedDepartments: parseJsonStringArray(row.allowed_departments),
    ownerUserId: ownerFromMetadata(row.metadata),
    metadata,
    embedding: null,
  };
}

async function rerankMerged(
  query: string,
  merged: ScoredChunk[],
  reranker: Reranker,
  fingerprint: RetrievalFingerprint,
): Promise<ScoredChunk[]> {
  const ordered = simpleRerank(merged, merged.length, fingerprint.channelOverlapBonus);
  const head = selectRerankHead({
    ordered,
    rerankCandidates: fingerprint.rerankCandidates,
    rescueCount: fingerprint.keywordRescue ?? 0,
  });
  const passages = head.map((item) => rerankWithHeading(item.chunk.sectionHeading, item.chunk.content));
  const scores = await reranker.rerank(query, passages);
  if (scores.length !== head.length) {
    throw new Error(`reranker returned ${scores.length} scores for ${head.length} passages`);
  }
  const scored = head.map((item, index) => ({ ...item, rerankScore: scores[index] }));
  scored.sort((left, right) => (right.rerankScore ?? 0) - (left.rerankScore ?? 0));
  return applyRelevanceFloor(scored, fingerprint.relevanceFloor);
}

function groupByDocument(chunks: ChunkRecord[]): Map<string, ChunkRecord[]> {
  const grouped = new Map<string, ChunkRecord[]>();
  for (const chunk of chunks) {
    const list = grouped.get(chunk.documentId) ?? [];
    list.push(chunk);
    grouped.set(chunk.documentId, list);
  }
  return grouped;
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function ownerFromMetadata(raw: string): string {
  const metadata = parseJsonObject(raw);
  return typeof metadata.owner_user_id === "string" ? metadata.owner_user_id : "";
}

export function vectorizeFilterUsesAclGroup(filter: Record<string, unknown>): boolean {
  return VECTORIZE_METADATA_INDEX in filter;
}
