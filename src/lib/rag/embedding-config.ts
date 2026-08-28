import { EMBEDDING_DIMENSIONS as WORKERS_AI_DIMENSIONS, EMBEDDING_MODEL } from "../embeddings/instructions";

export const EMBEDDING_DIMENSIONS = WORKERS_AI_DIMENSIONS;

export const embeddingConfig = {
  provider: "cloudflare-workers-ai",
  model: EMBEDDING_MODEL,
  dimensions: EMBEDDING_DIMENSIONS,
} as const;

export function isEmbeddingReady() {
  return {
    ok: true as const,
    message: "Workers AI embeddings are configured on Brain.",
  };
}
