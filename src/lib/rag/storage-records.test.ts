import { describe, expect, it } from "vitest";

import {
  summarizeEmbeddingStorageStatus,
  toDocumentChunkRecords,
  toSourceDocumentRecords,
} from "./storage-records";

describe("storage record helpers", () => {
  it("maps synthetic documents into stable source records", () => {
    const records = toSourceDocumentRecords([
      {
        source: "return_policy.md",
        title: "Return Policy",
        text: "# Return Policy\n\n## Window\nReturns are available.",
      },
    ]);

    expect(records).toEqual([
      {
        source: "return_policy.md",
        title: "Return Policy",
        textHash:
          "650f0108bb78393f7de76ae9aef7806aa69b28ba0836b4af73a434101e73b4a4",
        wordCount: 8,
      },
    ]);
  });

  it("maps visible chunks into chunk records", () => {
    const records = toDocumentChunkRecords([
      {
        id: "return_policy__chunk_001",
        source: "return_policy.md",
        section: "Window",
        text: "Returns are available.",
        tokenEstimate: 5,
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    ]);

    expect(records).toEqual([
      {
        chunkId: "return_policy__chunk_001",
        source: "return_policy.md",
        section: "Window",
        text: "Returns are available.",
        textHash:
          "ce65c54b669d8da16544c3b4c35382334132c7d2ea76d33214d5e649ba247ab1",
        chunkerVersion: "heading-v2",
        tokenEstimate: 5,
      },
    ]);
  });

  it("summarizes stored and embedded counts for the dashboard", () => {
    expect(
      summarizeEmbeddingStorageStatus({
        storedDocuments: 10,
        storedChunks: 31,
        embeddedChunks: 30,
        lastRunStatus: "failed",
        lastRunMessage: "1 chunk returned 3 dimensions.",
        lastEmbeddedAt: 1782920000000,
      }),
    ).toEqual({
      storedDocumentsLabel: "10 documents",
      storedChunksLabel: "31 stored",
      embeddedChunksLabel: "30 embedded",
      lastRunLabel: "failed",
      lastRunMessage: "1 chunk returned 3 dimensions.",
      lastEmbeddedAtLabel: "Jul 1, 2026",
    });
  });
});
