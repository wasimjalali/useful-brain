import { describe, expect, it } from "vitest";

import { aclFilterFor } from "./access";
import { FakeEmbeddingProvider } from "../retrieve/fake-embed";
import { MemoryChunkStore } from "../retrieve/memory-store";
import type { ChunkRecord } from "../retrieve/types";

function chunk(
  chunkId: string,
  content: string,
  accessScope: ChunkRecord["accessScope"],
  embedding: number[],
): ChunkRecord {
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
    embedding,
  };
}

describe("window eviction", () => {
  it("takes the vector window over allowed content only", async () => {
    const embedder = new FakeEmbeddingProvider(64);
    const query = await embedder.embedQuery("refund policy");
    const allowedEmbedding = await embedder.embedTexts(["refund policy window"]);
    const deniedEmbedding = await embedder.embedTexts(["refund policy secret"]);
    const store = new MemoryChunkStore();
    const allowed = Array.from({ length: 3 }, (_, i) =>
      chunk(`allowed-${i}`, "refund policy window", "public", allowedEmbedding[0]),
    );
    const denied = Array.from({ length: 8 }, (_, i) =>
      chunk(`denied-${i}`, "refund policy secret", "role", deniedEmbedding[0]),
    );
    store.upsert([...denied, ...allowed]);
    const acl = aclFilterFor({ userId: "eng_ic", roles: ["standard"], departments: ["engineering"] });
    const hits = store.vectorSearch(query, 5, acl);
    expect(hits).toHaveLength(3);
    expect(hits.every((hit) => hit.chunkId.startsWith("allowed-"))).toBe(true);
  });
});
