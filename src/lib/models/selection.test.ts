import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../embeddings/instructions";
import { RERANKER_MODEL } from "../retrieve/rerank";
import { CHAT_MODEL_ID, selectedCloudflareHostedModels, SELECTED_MODELS } from "./selection";

describe("Cloudflare-hosted model selection", () => {
  it("uses GLM 5.3 Flash for chat and the locked retrieval models", () => {
    expect(CHAT_MODEL_ID).toBe("@cf/zai-org/glm-5.3-flash");
    expect(SELECTED_MODELS.embedding.id).toBe(EMBEDDING_MODEL);
    expect(SELECTED_MODELS.embedding.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(SELECTED_MODELS.rerank.id).toBe(RERANKER_MODEL);
    expect(selectedCloudflareHostedModels().every((model) => model.id.startsWith("@cf/"))).toBe(
      true,
    );
  });
});
