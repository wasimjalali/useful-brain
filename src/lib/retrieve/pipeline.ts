import {
  aclFilterFor,
  filterChunks,
  principalHasFullDocumentAccess,
  type Principal,
} from "../acl/access";
import { FAKE_PROVIDER_FINGERPRINT, fingerprintId, type RetrievalFingerprint } from "./fingerprint";
import { fuseCandidates, simpleRerank } from "./fusion";
import { queryLooksLiteral, rescoreLocally } from "./keyword-score";
import type { FakeEmbeddingProvider } from "./fake-embed";
import { detectConflicts, expandParent } from "./parent-off";
import { applyRelevanceFloor, rerankWithHeading, type Reranker } from "./rerank";
import type { MemoryChunkStore } from "./memory-store";
import { MAX_CANDIDATE_LIMIT, MAX_QUERY_LENGTH, MAX_TOP_K, type SearchHit, type SearchResponse, type ScoredChunk } from "./types";

export type KnowledgePipelineOptions = {
  store: MemoryChunkStore;
  embedder: FakeEmbeddingProvider;
  fingerprint?: RetrievalFingerprint;
  reranker?: Reranker | null;
};

export class KnowledgePipeline {
  readonly store: MemoryChunkStore;
  private readonly embedder: FakeEmbeddingProvider;
  private readonly fingerprint: RetrievalFingerprint;
  private readonly reranker: Reranker | null;

  constructor(options: KnowledgePipelineOptions) {
    this.store = options.store;
    this.embedder = options.embedder;
    this.fingerprint = options.fingerprint ?? FAKE_PROVIDER_FINGERPRINT;
    this.reranker = options.reranker ?? null;
    if (this.fingerprint.relevanceFloor > 0 && !this.reranker) {
      throw new Error("relevance floor requires a reranker");
    }
  }

  async search(input: {
    query: string;
    principal: Principal;
    topK?: number;
    candidateLimit?: number;
  }): Promise<SearchResponse> {
    const topK = Math.max(1, Math.min(input.topK ?? 8, MAX_TOP_K));
    const candidateLimit = Math.max(1, Math.min(input.candidateLimit ?? 24, MAX_CANDIDATE_LIMIT));
    const fetchLimit = Math.max(candidateLimit, topK);
    const query = input.query.slice(0, MAX_QUERY_LENGTH);
    const acl = aclFilterFor(input.principal);
    const queryEmbedding = await this.embedder.embedQuery(query);
    const vectorHits = this.store.vectorSearch(queryEmbedding, fetchLimit, acl);
    const keywordLimit = Math.min(fetchLimit, this.fingerprint.keywordCandidates);
    const keywordHits = this.store.keywordSearch(query, keywordLimit, acl);
    const candidateIds = [...new Set([...vectorHits, ...keywordHits].map((hit) => hit.chunkId))].sort();
    const chunksById = this.store.getMany(candidateIds);
    const candidates = candidateIds.map((id) => chunksById[id]).filter(Boolean);
    const { allowed } = filterChunks(input.principal, candidates);
    const allowedIds = new Set(allowed.map((chunk) => chunk.chunkId));
    const allowedVectorHits = vectorHits.filter((hit) => allowedIds.has(hit.chunkId));
    const allowedKeywordHits = rescoreLocally(
      query,
      keywordHits.filter((hit) => allowedIds.has(hit.chunkId)),
      allowed,
    );
    const literal = queryLooksLiteral(query);
    const vectorWeight = literal
      ? (this.fingerprint.literalVectorWeight ?? this.fingerprint.vectorWeight)
      : this.fingerprint.vectorWeight;
    const keywordWeight = literal
      ? (this.fingerprint.literalKeywordWeight ?? this.fingerprint.keywordWeight)
      : this.fingerprint.keywordWeight;
    const merged = fuseCandidates({
      vectorHits: allowedVectorHits,
      keywordHits: allowedKeywordHits,
      chunksById,
      candidateLimit: fetchLimit,
      vectorWeight,
      keywordWeight,
    });
    const reranked = await this.rerank(query, merged);
    const final = reranked.slice(0, topK);
    void detectConflicts();
    const byDocument = this.store.chunksForDocuments([...new Set(final.map((item) => item.chunk.documentId))]);
    const publishAnchors = new Map(
      Object.entries(byDocument).map(([documentId, chunks]) => [
        documentId,
        principalHasFullDocumentAccess(input.principal, chunks),
      ]),
    );
    const hits: SearchHit[] = final.map((item) => {
      const publish = publishAnchors.get(item.chunk.documentId) === true;
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
    const vectorScores: Record<string, number> = {};
    const keywordScores: Record<string, number> = {};
    const fusedScores: Record<string, number> = {};
    const rerankScores: Record<string, number> = {};
    for (const item of final) {
      if (item.vectorScore !== null) {
        vectorScores[item.chunk.chunkId] = item.vectorScore;
      }
      if (item.keywordScore !== null) {
        keywordScores[item.chunk.chunkId] = item.keywordScore;
      }
      fusedScores[item.chunk.chunkId] = item.mergedScore;
      if (item.rerankScore !== null) {
        rerankScores[item.chunk.chunkId] = item.rerankScore;
      }
    }
    return {
      hits,
      trace: {
        query,
        finalChunkIds: hits.map((hit) => hit.chunkId),
        vectorScores,
        keywordScores,
        fusedScores,
        rerankScores,
        fingerprint: fingerprintId(this.fingerprint),
      },
    };
  }

  private async rerank(query: string, merged: ScoredChunk[]): Promise<ScoredChunk[]> {
    if (!this.reranker) {
      return simpleRerank(
        merged,
        merged.length,
        this.fingerprint.channelOverlapBonus,
      );
    }
    const ordered = simpleRerank(
      merged,
      merged.length,
      this.fingerprint.channelOverlapBonus,
    );
    const head = ordered.slice(0, this.fingerprint.rerankCandidates);
    const passages = head.map((item) => rerankWithHeading(item.chunk.sectionHeading, item.chunk.content));
    const scores = await this.reranker.rerank(query, passages);
    if (scores.length !== head.length) {
      throw new Error(`reranker returned ${scores.length} scores for ${head.length} passages`);
    }
    const scored = head.map((item, index) => ({ ...item, rerankScore: scores[index] }));
    scored.sort((left, right) => (right.rerankScore ?? 0) - (left.rerankScore ?? 0));
    return applyRelevanceFloor(scored, this.fingerprint.relevanceFloor);
  }
}
