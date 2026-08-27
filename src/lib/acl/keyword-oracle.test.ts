import { describe, expect, it } from "vitest";

import { KnowledgePipeline } from "../retrieve/pipeline";
import { FakeEmbeddingProvider } from "../retrieve/fake-embed";
import { MemoryChunkStore } from "../retrieve/memory-store";
import { FAKE_PROVIDER_FINGERPRINT } from "../retrieve/fingerprint";
import type { ChunkRecord } from "../retrieve/types";

function chunk(chunkId: string, content: string, accessScope: ChunkRecord["accessScope"] = "public"): ChunkRecord {
  return {
    chunkId,
    documentId: chunkId,
    title: chunkId,
    sourceName: chunkId,
    sourcePath: `${chunkId}.md`,
    sectionHeading: "Body",
    content,
    chunkIndex: 0,
    charStart: 0,
    charEnd: content.length,
    accessScope,
    allowedRoles: accessScope === "role" ? ["secret"] : [],
    allowedDepartments: [],
    ownerUserId: "",
    embedding: null,
  };
}

async function scoresWithDenied(includeDenied: boolean): Promise<Record<string, number>> {
  const embedder = new FakeEmbeddingProvider(64);
  const allowed = chunk("allowed", "refund policy RF-75 applies within forty eight hours");
  allowed.embedding = (await embedder.embedTexts([allowed.content]))[0];
  const store = new MemoryChunkStore();
  store.upsert([allowed]);
  if (includeDenied) {
    const denied = chunk("denied", "refund policy RF-75 secret severance multiplier", "role");
    denied.embedding = (await embedder.embedTexts([denied.content]))[0];
    store.upsert([denied]);
  }
  const pipeline = new KnowledgePipeline({ store, embedder, fingerprint: FAKE_PROVIDER_FINGERPRINT });
  const response = await pipeline.search({
    query: "RF-75 refund",
    principal: { userId: "eng_ic", roles: ["standard"], departments: ["engineering"] },
    topK: 3,
  });
  expect(response.hits.every((hit) => hit.chunkId !== "denied")).toBe(true);
  expect(response.trace.finalChunkIds).not.toContain("denied");
  expect(response.trace.keywordScores).not.toHaveProperty("denied");
  return response.trace.keywordScores;
}

describe("keyword oracle", () => {
  it("does not publish keyword scores that move when denied chunks are added", async () => {
    const withoutDenied = await scoresWithDenied(false);
    const withDenied = await scoresWithDenied(true);
    expect(withDenied).toEqual(withoutDenied);
  });
});
