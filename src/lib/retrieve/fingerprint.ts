export const REAL_STACK_FINGERPRINT = {
  name: "real-stack",
  maxTokens: 300,
  overlapTokens: 30,
  vectorWeight: 0.7,
  keywordWeight: 0.3,
  // Keyword-only rescue since the 2026-09-03 Northwind eval pass: with
  // fixed-bounds vector normalization every vector-only hit scores above any
  // keyword-only hit at 0.70/0.30, so an FTS top hit that the vector channel
  // missed (rare names, clause identifiers, connector IDs) never reached the
  // reranker. The top keywordRescue keyword-only hits are guaranteed a
  // rerank slot; the reranker and relevance floor still decide the final set.
  // (Equal 0.50/0.50 weights were measured first and fixed the same misses,
  // but promoted keyword junk corpus-wide and destabilized other questions.)
  keywordRescue: 3,
  keywordCandidates: 6,
  channelOverlapBonus: 0.05,
  rerankCandidates: 20,
  reranker: "@cf/baai/bge-reranker-base",
  relevanceFloor: 0.05,
  // The approved retrieval profile returns up to eight chunks. Raised from
  // the interim 3 through the 2026-08-30 Northwind eval pass.
  topK: 8,
  parentExpansion: "off",
  conflictDetection: "off",
  ftsMatchStrategy: "stopword-or-v1",
} as const;

export const FAKE_PROVIDER_FINGERPRINT = {
  name: "fake-provider",
  maxTokens: 500,
  overlapTokens: 50,
  vectorWeight: 0.2,
  keywordWeight: 0.8,
  keywordCandidates: 6,
  channelOverlapBonus: 0.02,
  rerankCandidates: 20,
  reranker: "none",
  relevanceFloor: 0,
  topK: 3,
  parentExpansion: "off",
  conflictDetection: "off",
  ftsMatchStrategy: "stopword-or-v1",
} as const;

export const FAKE_RERANK_FINGERPRINT = {
  name: "fake-rerank",
  maxTokens: 500,
  overlapTokens: 50,
  vectorWeight: 0.55,
  keywordWeight: 0.45,
  keywordCandidates: 6,
  channelOverlapBonus: 0.05,
  rerankCandidates: 20,
  reranker: "fake",
  relevanceFloor: 0,
  topK: 3,
  parentExpansion: "off",
  conflictDetection: "off",
  ftsMatchStrategy: "stopword-or-v1",
} as const;

export type RetrievalFingerprint = {
  name: string;
  maxTokens: number;
  overlapTokens: number;
  vectorWeight: number;
  keywordWeight: number;
  literalVectorWeight?: number;
  literalKeywordWeight?: number;
  keywordCandidates: number;
  /** Top keyword-only hits guaranteed a rerank slot; 0/absent disables. */
  keywordRescue?: number;
  channelOverlapBonus: number;
  rerankCandidates: number;
  reranker: string;
  relevanceFloor: number;
  topK: number;
  parentExpansion: "off";
  conflictDetection: "off";
  ftsMatchStrategy: "stopword-or-v1";
};

export function fingerprintId(fingerprint: RetrievalFingerprint): string {
  return [
    fingerprint.name,
    `${fingerprint.maxTokens}/${fingerprint.overlapTokens}`,
    `${fingerprint.vectorWeight.toFixed(2)}/${fingerprint.keywordWeight.toFixed(2)}`,
    `kw${fingerprint.keywordCandidates}`,
    `kr${fingerprint.keywordRescue ?? 0}`,
    `cb${fingerprint.channelOverlapBonus.toFixed(2)}`,
    `rr${fingerprint.rerankCandidates}`,
    fingerprint.reranker,
    `floor${fingerprint.relevanceFloor}`,
    `top${fingerprint.topK}`,
    `fts-${fingerprint.ftsMatchStrategy}`,
  ].join("|");
}
