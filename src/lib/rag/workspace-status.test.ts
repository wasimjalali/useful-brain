import { describe, expect, it } from "vitest";

import { emptyEmbeddingStorageStatus } from "./storage-records";
import { isRetrievalReady } from "./workspace-status";

describe("isRetrievalReady", () => {
  it("requires an explicitly active generation", () => {
    expect(
      isRetrievalReady({
        ...emptyEmbeddingStorageStatus,
        corpusStatus: "ready",
        readyVersionId: "g-ready",
        embeddedChunks: 12,
      }),
    ).toBe(false);
    expect(
      isRetrievalReady({
        ...emptyEmbeddingStorageStatus,
        corpusStatus: "active",
        activeVersionId: "g-active",
        embeddedChunks: 12,
      }),
    ).toBe(true);
  });
});
