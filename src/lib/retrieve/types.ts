import type { AccessScope } from "../acl/acl-group";

export const MAX_TOP_K = 50;
export const MAX_CANDIDATE_LIMIT = 200;
export const MAX_QUERY_LENGTH = 4096;

export type RetrievalHit = {
  chunkId: string;
  score: number;
};

export type ChunkRecord = {
  chunkId: string;
  documentId: string;
  title: string;
  sourceName: string;
  sourcePath: string;
  sectionHeading: string;
  content: string;
  chunkIndex: number;
  charStart: number;
  charEnd: number;
  accessScope: AccessScope;
  allowedRoles: string[];
  allowedDepartments: string[];
  ownerUserId: string;
  embedding: number[] | null;
  metadata?: Record<string, unknown>;
  version?: string;
  effectiveDate?: string;
};

export type SearchCitation = {
  chunkId: string;
  documentId: string;
  sourceName: string;
  sourcePath: string;
  sectionHeading: string;
  charStart: number | null;
  charEnd: number | null;
};

export type SearchHit = {
  chunkId: string;
  content: string;
  score: number;
  citation: SearchCitation;
};

export type RetrievalTrace = {
  query: string;
  finalChunkIds: string[];
  vectorScores: Record<string, number>;
  keywordScores: Record<string, number>;
  fusedScores: Record<string, number>;
  rerankScores: Record<string, number>;
  fingerprint: string;
};

export type SearchResponse = {
  hits: SearchHit[];
  trace: RetrievalTrace;
};

export type ScoredChunk = {
  chunk: ChunkRecord;
  vectorScore: number | null;
  keywordScore: number | null;
  mergedScore: number;
  rerankScore: number | null;
};
