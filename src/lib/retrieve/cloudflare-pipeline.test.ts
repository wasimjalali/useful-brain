import { describe, expect, it } from "vitest";

import { CloudflareKnowledgePipeline, type CorpusSql } from "./cloudflare-pipeline";

const chunkRow = {
  chunk_id: "refund__001",
  document_id: "refund",
  heading: "Refund window",
  content: "Annual plans have a fourteen day refund window.",
  chunk_index: 0,
  start_offset: 0,
  end_offset: 48,
  access_scope: "public",
  allowed_roles: "[]",
  allowed_departments: "[]",
  metadata: "{}",
  path: "refund.md",
};

function keywordDatabase(): CorpusSql {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async all<T>() {
              let rows: unknown[];
              if (sql.includes("SELECT DISTINCT access_scope")) {
                rows = [
                  {
                    access_scope: "public",
                    allowed_roles: "[]",
                    allowed_departments: "[]",
                    metadata: "{}",
                  },
                ];
              } else if (sql.includes("chunks_fts MATCH")) {
                rows = [{ chunk_id: chunkRow.chunk_id }];
              } else if (sql.includes("SELECT vector_id, chunk_id")) {
                rows = [{ vector_id: "vector-1", chunk_id: chunkRow.chunk_id }];
              } else if (sql.includes("FROM chunks c")) {
                rows = [chunkRow];
              } else {
                throw new Error(`Unexpected SQL: ${sql}`);
              }
              return { results: rows as T[] };
            },
            async first<T>() {
              return null as T | null;
            },
          };
        },
      };
    },
  };
}

const principal = { userId: "operator", roles: ["operator"], departments: [] };

describe("CloudflareKnowledgePipeline failures", () => {
  it("fails closed when the configured reranker is unavailable", async () => {
    const pipeline = new CloudflareKnowledgePipeline({
      db: keywordDatabase(),
      vectorize: null,
      ai: { run: async () => ({ data: [] }) },
      reranker: {
        rerank: async () => {
          throw new Error("reranker unavailable");
        },
      },
      generationId: "g-1",
    });

    await expect(pipeline.search({ query: "refund window", principal })).rejects.toThrow(
      "reranker unavailable",
    );
  });

  it("does not silently downgrade hybrid retrieval when embeddings fail", async () => {
    const pipeline = new CloudflareKnowledgePipeline({
      db: keywordDatabase(),
      vectorize: { query: async () => ({ matches: [] }) },
      ai: {
        run: async () => {
          throw new Error("embedding unavailable");
        },
      },
      reranker: { rerank: async (_query, passages) => passages.map(() => 0.9) },
      generationId: "g-1",
    });

    await expect(pipeline.search({ query: "refund window", principal })).rejects.toThrow(
      "embedding unavailable",
    );
  });

  it("maps Vectorize IDs back to authoritative D1 chunk IDs", async () => {
    const pipeline = new CloudflareKnowledgePipeline({
      db: keywordDatabase(),
      vectorize: { query: async () => ({ matches: [{ id: "vector-1", score: 0.92 }] }) },
      ai: { run: async () => ({ data: [Array.from({ length: 1024 }, () => 0.1)] }) },
      reranker: { rerank: async (_query, passages) => passages.map(() => 0.97) },
      generationId: "g-1",
    });

    const result = await pipeline.search({ query: "refund window", principal });

    expect(result.hits[0]?.chunkId).toBe(chunkRow.chunk_id);
    expect(result.trace.vectorScores[chunkRow.chunk_id]).toBe(0.96);
    expect(result.trace.keywordScores[chunkRow.chunk_id]).toBeGreaterThan(0);
    expect(result.trace.fusedScores[chunkRow.chunk_id]).toBeGreaterThan(0);
    expect(result.trace.rerankScores[chunkRow.chunk_id]).toBe(0.97);
  });
});
