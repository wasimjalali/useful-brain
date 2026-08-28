export const REAL_STACK_FINGERPRINT = {
  name: "real-stack",
  maxTokens: 300,
  overlapTokens: 30,
  vectorWeight: 0.7,
  keywordWeight: 0.3,
  keywordCandidates: 6,
  channelOverlapBonus: 0.05,
  rerankCandidates: 20,
  reranker: "@cf/baai/bge-reranker-base",
  relevanceFloor: 0.05,
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
  channelOverlapBonus: number;
  rerankCandidates: number;
  reranker: string;
  relevanceFloor: number;
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
    `cb${fingerprint.channelOverlapBonus.toFixed(2)}`,
    `rr${fingerprint.rerankCandidates}`,
    fingerprint.reranker,
    `floor${fingerprint.relevanceFloor}`,
    `fts-${fingerprint.ftsMatchStrategy}`,
  ].join("|");
}
