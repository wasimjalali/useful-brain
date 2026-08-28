import { describe, expect, it } from "vitest";

import { EMBEDDING_MODEL } from "../embeddings/instructions";
import {
  EMBEDDING_DIMENSIONS,
  embeddingConfig,
  isEmbeddingReady,
} from "./embedding-config";
import { validateEmbeddingDimensions } from "./vector-validation";

describe("embedding readiness", () => {
  it("locks the Workers AI embedding model and dimensions", () => {
    expect(embeddingConfig).toEqual({
      provider: "cloudflare-workers-ai",
      model: EMBEDDING_MODEL,
      dimensions: 1024,
    });
    expect(EMBEDDING_DIMENSIONS).toBe(1024);
  });

  it("accepts vectors with the configured dimensions", () => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

    expect(validateEmbeddingDimensions(vector)).toEqual({
      ok: true,
      actualDimensions: 1024,
      expectedDimensions: 1024,
    });
  });

  it("rejects vectors with mismatched dimensions", () => {
    expect(validateEmbeddingDimensions([0.1, 0.2, 0.3])).toEqual({
      ok: false,
      actualDimensions: 3,
      expectedDimensions: 1024,
      message: "Expected 1024 dimensions but received 3.",
    });
  });

  it("rejects vectors containing non-finite elements", () => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
    vector[42] = Number.NaN;

    expect(validateEmbeddingDimensions(vector)).toEqual({
      ok: false,
      actualDimensions: EMBEDDING_DIMENSIONS,
      expectedDimensions: EMBEDDING_DIMENSIONS,
      message: "Vector contains a non-finite value at index 42.",
    });

    const infiniteVector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
    infiniteVector[7] = Number.POSITIVE_INFINITY;

    expect(validateEmbeddingDimensions(infiniteVector)).toEqual({
      ok: false,
      actualDimensions: EMBEDDING_DIMENSIONS,
      expectedDimensions: EMBEDDING_DIMENSIONS,
      message: "Vector contains a non-finite value at index 7.",
    });
  });

  it("reports Workers AI embeddings as configured", () => {
    expect(isEmbeddingReady()).toEqual({
      ok: true,
      message: "Workers AI embeddings are configured on Brain.",
    });
  });
});
