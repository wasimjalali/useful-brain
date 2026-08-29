import type { EmbeddingStorageStatus } from "./storage-records";

export function isRetrievalReady(status: EmbeddingStorageStatus): boolean {
  return status.corpusStatus === "active" && Boolean(status.activeVersionId);
}
