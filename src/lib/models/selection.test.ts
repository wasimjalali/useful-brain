import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../embeddings/instructions";
import { RERANKER_MODEL } from "../retrieve/rerank";
import { CHAT_MODEL_ID, selectedCloudflareHostedModels, SELECTED_MODELS } from "./selection";

describe("Cloudflare-hosted model selection", () => {
  it("uses DeepSeek V4.1 Flash for chat and the locked retrieval models", () => {
    expect(CHAT_MODEL_ID).toBe("@cf/deepseek-ai/deepseek-v4.1-flash-1017");
    expect(SELECTED_MODELS.embedding.id).toBe(EMBEDDING_MODEL);
    expect(SELECTED_MODELS.embedding.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(SELECTED_MODELS.rerank.id).toBe(RERANKER_MODEL);
    expect(selectedCloudflareHostedModels().every((model) => model.id.startsWith("@cf/"))).toBe(
      true,
    );
  });
});
