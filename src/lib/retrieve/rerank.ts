import type { ScoredChunk } from "./types";

export const RERANKER_MODEL = "@cf/baai/bge-reranker-base";
export const DEFAULT_RERANK_CANDIDATES = 20;
export const DEFAULT_RELEVANCE_FLOOR = 0.05;

const TOKEN_RE = /[a-z0-9_]+/gi;

export type Reranker = {
  rerank(query: string, passages: string[]): Promise<number[]> | number[];
};

export class FakeReranker implements Reranker {
  rerank(query: string, passages: string[]): number[] {
    const wanted = new Set(query.toLowerCase().match(TOKEN_RE) ?? []);
    if (wanted.size === 0) {
      return passages.map(() => 0);
    }
    return passages.map((passage) => {
      const terms = new Set(passage.toLowerCase().match(TOKEN_RE) ?? []);
      let overlap = 0;
      for (const term of wanted) {
        if (terms.has(term)) {
          overlap += 1;
        }
      }
      return overlap / wanted.size;
    });
  }
}

export function applyRelevanceFloor(items: ScoredChunk[], floor: number): ScoredChunk[] {
  if (floor <= 0) {
    return items;
  }
  return items.filter((item) => (item.rerankScore ?? 0) >= floor);
}

export function rerankWithHeading(heading: string, content: string): string {
  if (!heading) {
    return content;
  }
  return `${heading}\n\n${content}`;
}
