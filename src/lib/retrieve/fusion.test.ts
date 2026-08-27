import { describe, expect, it } from "vitest";

import { fuseCandidates, simpleRerank } from "./fusion";
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
