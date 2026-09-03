import type { ChunkRecord, RetrievalHit, ScoredChunk } from "./types";

export const VECTOR_WEIGHT = 0.7;
export const KEYWORD_WEIGHT = 0.3;
export const FAKE_VECTOR_WEIGHT = 0.2;
export const FAKE_KEYWORD_WEIGHT = 0.8;

const COSINE_EPSILON = 1e-6;

export class FusionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FusionError";
  }
}

function normalizeVector(hits: RetrievalHit[]): Record<string, number> {
  const norm: Record<string, number> = {};
  for (const hit of hits) {
    if (Math.abs(hit.score) > 1 + COSINE_EPSILON) {
      throw new FusionError(
        `vector_search returned ${hit.score} for chunk ${hit.chunkId}; RetrievalHit requires cosine similarity in [-1, 1]`,
      );
    }
    norm[hit.chunkId] = Math.min(1, Math.max(0, (hit.score + 1) / 2));
  }
  return norm;
}

function normalizeKeyword(hits: RetrievalHit[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const hit of hits) {
    scores[hit.chunkId] = Math.max(hit.score, 0);
  }
  const top = Math.max(0, ...Object.values(scores), 0);
  if (top <= 0) {
    return Object.fromEntries(Object.keys(scores).map((id) => [id, 0]));
  }
  return Object.fromEntries(Object.entries(scores).map(([id, score]) => [id, score / top]));
}

export function fuseCandidates(input: {
  vectorHits: RetrievalHit[];
  keywordHits: RetrievalHit[];
  chunksById: Record<string, ChunkRecord>;
  candidateLimit: number;
  vectorWeight?: number;
  keywordWeight?: number;
  /**
   * Keyword-only blind-spot cover: keep up to this many top keyword-only
   * hits (no vector hit) past the candidate slice so they can reach the
   * reranker. 0 (default) preserves the legacy slice exactly.
   */
  keywordRescue?: number;
}): ScoredChunk[] {
  const vectorWeight = input.vectorWeight ?? VECTOR_WEIGHT;
  const keywordWeight = input.keywordWeight ?? KEYWORD_WEIGHT;
  if (vectorWeight <= 0 || keywordWeight <= 0) {
    throw new FusionError(
      `fuse_candidates needs positive channel weights, got vector_weight=${vectorWeight} keyword_weight=${keywordWeight}`,
    );
  }
  const vNorm = normalizeVector(input.vectorHits);
  const kNorm = normalizeKeyword(input.keywordHits);
  const totalWeight = vectorWeight + keywordWeight;
  const ids = new Set([...Object.keys(vNorm), ...Object.keys(kNorm)]);
  const scored: ScoredChunk[] = [];
  for (const chunkId of ids) {
    const chunk = input.chunksById[chunkId];
    if (!chunk) {
      continue;
    }
    const v = vNorm[chunkId];
    const k = kNorm[chunkId];
    const merged = (vectorWeight * (v ?? 0) + keywordWeight * (k ?? 0)) / totalWeight;
    scored.push({
      chunk,
      vectorScore: v === undefined ? null : v,
      keywordScore: k === undefined ? null : k,
      mergedScore: merged,
      rerankScore: null,
    });
  }
  scored.sort((left, right) => {
    if (right.mergedScore !== left.mergedScore) {
      return right.mergedScore - left.mergedScore;
    }
    return left.chunk.chunkId.localeCompare(right.chunk.chunkId);
  });
  const sliced = scored.slice(0, input.candidateLimit);
  const rescue = Math.max(0, input.keywordRescue ?? 0);
  if (rescue === 0) {
    return sliced;
  }
  const kept = new Set(sliced.map((item) => item.chunk.chunkId));
  let added = 0;
  for (const item of scored) {
    if (added >= rescue) {
      break;
    }
    if (kept.has(item.chunk.chunkId) || !isKeywordOnly(item)) {
      continue;
    }
    sliced.push(item);
    kept.add(item.chunk.chunkId);
    added += 1;
  }
  return sliced;
}

/** A hit the vector channel missed: exact-token FTS matches live here. */
function isKeywordOnly(item: ScoredChunk): boolean {
  return item.vectorScore === null && item.keywordScore !== null;
}

/**
 * Build the reranker head so rescued keyword-only hits are always scored:
 * rescued items first (keyword-rank order), then the fused order up to the
 * cap. Without rescued items this is a plain top-N slice.
 */
export function selectRerankHead(input: {
  ordered: ScoredChunk[];
  rerankCandidates: number;
  rescueCount?: number;
}): ScoredChunk[] {
  const cap = Math.max(0, input.rerankCandidates);
  const rescue = Math.max(0, input.rescueCount ?? 0);
  if (rescue === 0) {
    return input.ordered.slice(0, cap);
  }
  const rescued = input.ordered.filter(isKeywordOnly).slice(0, rescue);
  const rescuedIds = new Set(rescued.map((item) => item.chunk.chunkId));
  const rest = input.ordered.filter((item) => !rescuedIds.has(item.chunk.chunkId));
  return [...rescued, ...rest].slice(0, cap);
}

export function simpleRerank(
  scored: ScoredChunk[],
  topK: number,
  channelOverlapBonus = 0.05,
): ScoredChunk[] {
  const reranked = scored.map((item) => {
    const both = item.vectorScore !== null && item.keywordScore !== null;
    return { ...item, rerankScore: item.mergedScore + (both ? channelOverlapBonus : 0) };
  });
  reranked.sort((left, right) => {
    const leftScore = left.rerankScore ?? 0;
    const rightScore = right.rerankScore ?? 0;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return left.chunk.chunkId.localeCompare(right.chunk.chunkId);
  });
  return reranked.slice(0, topK);
}
