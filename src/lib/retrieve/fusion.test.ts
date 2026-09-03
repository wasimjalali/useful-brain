import { describe, expect, it } from "vitest";

import { fuseCandidates, selectRerankHead, simpleRerank } from "./fusion";
import type { ChunkRecord } from "./types";

const ALGEBRA = { vectorWeight: 0.55, keywordWeight: 0.45 };

function chunk(chunkId: string): ChunkRecord {
  return {
    chunkId,
    documentId: "d",
    title: "T",
    sourceName: "S",
    sourcePath: "s.md",
    sectionHeading: "Sec",
    content: chunkId,
    chunkIndex: 0,
    charStart: 0,
    charEnd: 1,
    accessScope: "public",
    allowedRoles: [],
    allowedDepartments: [],
    ownerUserId: "",
    embedding: null,
  };
}

function chunks(...ids: string[]) {
  return Object.fromEntries(ids.map((id) => [id, chunk(id)]));
}

describe("fusion", () => {
  it("normalizes cosine against fixed bounds, not min-max", () => {
    const fused = fuseCandidates({
      vectorHits: [
        { chunkId: "a", score: 0.9 },
        { chunkId: "b", score: 0.1 },
        { chunkId: "drift_hi", score: 1 + 5e-7 },
        { chunkId: "drift_lo", score: -1 - 5e-7 },
      ],
      keywordHits: [],
      chunksById: chunks("a", "b", "drift_hi", "drift_lo"),
      candidateLimit: 10,
      ...ALGEBRA,
    });
    const byId = Object.fromEntries(fused.map((item) => [item.chunk.chunkId, item]));
    expect(Math.abs((byId.a.vectorScore ?? 0) - 0.95)).toBeLessThan(1e-9);
    expect(Math.abs((byId.b.vectorScore ?? 0) - 0.55)).toBeLessThan(1e-9);
    expect(byId.drift_hi.vectorScore).toBe(1);
    expect(byId.drift_lo.vectorScore).toBe(0);
    expect(Math.abs(byId.a.mergedScore - 0.5225)).toBeLessThan(1e-9);
  });

  it("rejects a vector score outside cosine range", () => {
    expect(() =>
      fuseCandidates({
        vectorHits: [{ chunkId: "bad", score: 1.4 }],
        keywordHits: [],
        chunksById: chunks("bad"),
        candidateLimit: 10,
        ...ALGEBRA,
      }),
    ).toThrow(/1.4/);
  });

  it("lets a second channel add rather than dilute", () => {
    const vectorOnly = fuseCandidates({
      vectorHits: [{ chunkId: "a", score: 0.8 }],
      keywordHits: [],
      chunksById: chunks("a"),
      candidateLimit: 10,
      ...ALGEBRA,
    })[0];
    const both = fuseCandidates({
      vectorHits: [{ chunkId: "a", score: 0.8 }],
      keywordHits: [{ chunkId: "a", score: 4 }],
      chunksById: chunks("a"),
      candidateLimit: 10,
      ...ALGEBRA,
    })[0];
    expect(both.mergedScore).toBeGreaterThan(vectorOnly.mergedScore);
  });

  it("rescues top keyword-only hits past the fused slice", () => {
    // Regression guard for the 2026-09-03 Northwind pass: an FTS top hit the
    // vector channel missed (rare name, clause identifier, connector ID)
    // scores below every vector-only hit under 0.70/0.30 weights, so without
    // rescue it never reaches the reranker.
    const vectorHits = Array.from({ length: 24 }, (_, index) => ({
      chunkId: `vector-only-${index.toString().padStart(2, "0")}`,
      score: 0.3,
    }));
    const ids = ["keyword-exact", ...vectorHits.map((hit) => hit.chunkId)];
    const base = {
      vectorHits,
      keywordHits: [{ chunkId: "keyword-exact", score: 10 }],
      chunksById: chunks(...ids),
      candidateLimit: 24,
      vectorWeight: 0.7,
      keywordWeight: 0.3,
    };
    const without = fuseCandidates(base);
    expect(without.map((item) => item.chunk.chunkId)).not.toContain("keyword-exact");
    const rescued = fuseCandidates({ ...base, keywordRescue: 3 });
    expect(rescued).toHaveLength(25);
    expect(rescued.map((item) => item.chunk.chunkId)).toContain("keyword-exact");
  });

  it("guarantees rescued hits a rerank slot without disturbing fused order", () => {
    const vectorHits = Array.from({ length: 8 }, (_, index) => ({
      chunkId: `v-${index}`,
      score: 0.9,
    }));
    const fused = fuseCandidates({
      vectorHits,
      keywordHits: [
        { chunkId: "k-only", score: 5 },
        { chunkId: "v-0", score: 0.1 },
      ],
      chunksById: chunks("k-only", ...vectorHits.map((hit) => hit.chunkId)),
      candidateLimit: 8,
      keywordRescue: 3,
      ...ALGEBRA,
    });
    const ordered = simpleRerank(fused, fused.length);
    // Without rescue the keyword-only hit is cut from a head of 8.
    expect(ordered.slice(0, 8).map((item) => item.chunk.chunkId)).not.toContain("k-only");
    const head = selectRerankHead({ ordered, rerankCandidates: 8, rescueCount: 3 });
    expect(head).toHaveLength(8);
    expect(head[0].chunk.chunkId).toBe("k-only");
    // Dual-channel hits keep their fused relative order behind the rescue.
    expect(head.slice(1).map((item) => item.chunk.chunkId)).toEqual(
      ordered.filter((item) => item.chunk.chunkId !== "k-only").slice(0, 7).map((item) => item.chunk.chunkId),
    );
  });

  it("leaves the head untouched when rescue is disabled", () => {
    const fused = fuseCandidates({
      vectorHits: [{ chunkId: "a", score: 0.8 }],
      keywordHits: [{ chunkId: "b", score: 4 }],
      chunksById: chunks("a", "b"),
      candidateLimit: 10,
      ...ALGEBRA,
    });
    const ordered = simpleRerank(fused, fused.length);
    expect(selectRerankHead({ ordered, rerankCandidates: 1 })).toEqual(ordered.slice(0, 1));
    expect(selectRerankHead({ ordered, rerankCandidates: 1, rescueCount: 0 })).toEqual(
      ordered.slice(0, 1),
    );
  });

  it("boosts agreement in simple rerank without changing membership", () => {
    const fused = fuseCandidates({
      vectorHits: [{ chunkId: "a", score: 1 }],
      keywordHits: [{ chunkId: "a", score: 1 }, { chunkId: "b", score: 1 }],
      chunksById: chunks("a", "b"),
      candidateLimit: 10,
      ...ALGEBRA,
    });
    const reranked = simpleRerank(fused, 2);
    expect(reranked[0].chunk.chunkId).toBe("a");
    expect(reranked[0].rerankScore).toBeGreaterThan(reranked[0].mergedScore);
  });
});
