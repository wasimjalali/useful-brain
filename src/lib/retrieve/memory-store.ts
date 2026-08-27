import { chunkMatchesFilter, type AclFilter } from "../acl/access";
import { cosineSimilarity } from "./fake-embed";
import type { ChunkRecord, RetrievalHit } from "./types";

const TOKEN_RE = /[a-z0-9_]+/gi;
const K1 = 1.5;
const B = 0.75;

function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN_RE) ?? [];
}

export class MemoryChunkStore {
  private chunks = new Map<string, ChunkRecord>();

  upsert(chunks: ChunkRecord[]): void {
    for (const chunk of chunks) {
      this.chunks.set(chunk.chunkId, chunk);
    }
  }

  get(chunkId: string): ChunkRecord | undefined {
    return this.chunks.get(chunkId);
  }

  getMany(chunkIds: string[]): Record<string, ChunkRecord> {
    const out: Record<string, ChunkRecord> = {};
    for (const id of chunkIds) {
      const chunk = this.chunks.get(id);
      if (chunk) {
        out[id] = chunk;
      }
    }
    return out;
  }

  all(): ChunkRecord[] {
    return [...this.chunks.values()];
  }

  chunksForDocuments(documentIds: string[]): Record<string, ChunkRecord[]> {
    const wanted = new Set(documentIds);
    const out: Record<string, ChunkRecord[]> = {};
    for (const id of wanted) {
      out[id] = [];
    }
    for (const chunk of this.chunks.values()) {
      if (wanted.has(chunk.documentId)) {
        out[chunk.documentId].push(chunk);
      }
    }
    for (const id of Object.keys(out)) {
      out[id].sort((left, right) => left.chunkIndex - right.chunkIndex || left.chunkId.localeCompare(right.chunkId));
    }
    return out;
  }

  vectorSearch(queryEmbedding: number[], limit: number, acl: AclFilter): RetrievalHit[] {
    const hits: RetrievalHit[] = [];
    for (const chunk of this.chunks.values()) {
      if (!chunk.embedding || !chunkMatchesFilter(acl, chunk)) {
        continue;
      }
      hits.push({ chunkId: chunk.chunkId, score: cosineSimilarity(queryEmbedding, chunk.embedding) });
    }
    hits.sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId));
    return hits.slice(0, limit);
  }

  keywordSearch(query: string, limit: number, acl: AclFilter): RetrievalHit[] {
    const terms = tokenize(query);
    if (terms.length === 0) {
      return [];
    }
    const stats = this.termStats();
    if (!stats) {
      return [];
    }
    const { countsByChunk, lengths, documentFrequency, averageLength } = stats;
    const total = Object.keys(countsByChunk).length;
    const hits: RetrievalHit[] = [];
    for (const [chunkId, counts] of Object.entries(countsByChunk)) {
      const length = lengths[chunkId];
      if (!length) {
        continue;
      }
      let score = 0;
      for (const term of new Set(terms)) {
        const frequency = counts[term] ?? 0;
        if (!frequency) {
          continue;
        }
        const appearances = documentFrequency[term] ?? 0;
        const idf = Math.log(1 + (total - appearances + 0.5) / (appearances + 0.5));
        score += idf * ((frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * length) / averageLength)));
      }
      if (score <= 0) {
        continue;
      }
      const chunk = this.chunks.get(chunkId);
      if (!chunk || !chunkMatchesFilter(acl, chunk)) {
        continue;
      }
      hits.push({ chunkId, score });
    }
    hits.sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId));
    return hits.slice(0, limit);
  }

  private termStats() {
    if (this.chunks.size === 0) {
      return null;
    }
    const countsByChunk: Record<string, Record<string, number>> = {};
    const lengths: Record<string, number> = {};
    const documentFrequency: Record<string, number> = {};
    for (const [chunkId, chunk] of this.chunks) {
      const counts: Record<string, number> = {};
      for (const token of tokenize(chunk.content)) {
        counts[token] = (counts[token] ?? 0) + 1;
      }
      countsByChunk[chunkId] = counts;
      lengths[chunkId] = Object.values(counts).reduce((a, b) => a + b, 0);
      for (const token of Object.keys(counts)) {
        documentFrequency[token] = (documentFrequency[token] ?? 0) + 1;
      }
    }
    const averageLength = Object.values(lengths).reduce((a, b) => a + b, 0) / Object.keys(lengths).length || 1;
    return { countsByChunk, lengths, documentFrequency, averageLength };
  }
}
