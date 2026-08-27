import { describe, expect, it } from "vitest";

import { FakeEmbeddingProvider } from "./fake-embed";
import { MemoryChunkStore } from "./memory-store";
import { KnowledgePipeline } from "./pipeline";
import { FAKE_PROVIDER_FINGERPRINT } from "./fingerprint";
import type { ChunkRecord } from "./types";

function chunk(
  chunkId: string,
  documentId: string,
  content: string,
  accessScope: ChunkRecord["accessScope"],
  allowedDepartments: string[] = [],
): ChunkRecord {
  return {
    chunkId,
    documentId,
    title: documentId,
    sourceName: documentId,
    sourcePath: `${documentId}.md`,
    sectionHeading: "Executive bonus pool",
    content,
    chunkIndex: Number(chunkId.endsWith("1")),
    charStart: 0,
    charEnd: content.length,
    accessScope,
    allowedRoles: [],
    allowedDepartments,
    ownerUserId: "",
    embedding: null,
  };
}

describe("retrieval traces", () => {
  it("does not name, score, or count denied chunks", async () => {
    const embedder = new FakeEmbeddingProvider(64);
    const denied = chunk(
      "board_comp_2026__executive_bonus_pool__000",
      "board_comp_2026",
      "Riyaz bonus is 1200000 approved by cfo.",
      "department",
      ["management"],
    );
    denied.embedding = (await embedder.embedTexts([denied.content]))[0];
    const store = new MemoryChunkStore();
    store.upsert([denied]);
    const pipeline = new KnowledgePipeline({ store, embedder, fingerprint: FAKE_PROVIDER_FINGERPRINT });
    const intern = { userId: "intern", roles: ["standard"], departments: ["support"] };
    const withTerm = await pipeline.search({ query: "bonus", principal: intern, topK: 5 });
    const withoutTerm = await pipeline.search({ query: "zephyr", principal: intern, topK: 5 });
    expect(withTerm.hits).toEqual([]);
    expect(withTerm.trace.finalChunkIds).toEqual([]);
    expect(withTerm.trace.vectorScores).toEqual({});
    expect(withTerm.trace.keywordScores).toEqual({});
    expect(withTerm.trace.fusedScores).toEqual({});
    expect(withTerm.trace.rerankScores).toEqual({});
    expect(JSON.stringify(withTerm)).not.toMatch(/board_comp_2026|permission_removed|1200000/);
    expect(JSON.stringify(withTerm.trace)).toBe(JSON.stringify(withoutTerm.trace).replaceAll("zephyr", "bonus"));
  });

  it("withholds passage anchors unless every chunk of the document is allowed", async () => {
    const embedder = new FakeEmbeddingProvider(64);
    const publicChunk = chunk("mixed__body__000", "mixed", "public refund policy RF-75", "public");
    const privateChunk = chunk("mixed__secret__001", "mixed", "secret multiplier", "role");
    privateChunk.allowedRoles = ["secret"];
    publicChunk.embedding = (await embedder.embedTexts([publicChunk.content]))[0];
    privateChunk.embedding = (await embedder.embedTexts([privateChunk.content]))[0];
    const store = new MemoryChunkStore();
    store.upsert([publicChunk, privateChunk]);
    const pipeline = new KnowledgePipeline({ store, embedder, fingerprint: FAKE_PROVIDER_FINGERPRINT });
    const response = await pipeline.search({
      query: "refund policy RF-75",
      principal: { userId: "eng_ic", roles: ["standard"], departments: ["engineering"] },
      topK: 3,
    });
    expect(response.hits.length).toBeGreaterThan(0);
    expect(response.hits.every((hit) => hit.citation.charStart === null && hit.citation.charEnd === null)).toBe(true);
    expect(response.hits.every((hit) => hit.chunkId !== privateChunk.chunkId)).toBe(true);
  });
});
