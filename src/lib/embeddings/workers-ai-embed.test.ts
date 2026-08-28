import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "./instructions";
import { parseEmbeddingVectors } from "./workers-ai-embed";

function vector(fill: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => fill);
}

describe("Workers AI embedding parser", () => {
  it("reads OpenAI-shaped data[].embedding arrays", () => {
    const parsed = parseEmbeddingVectors(
      { data: [{ embedding: vector(0.1) }, { embedding: vector(0.2) }] },
      2,
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(parsed[1][0]).toBe(0.2);
  });

  it("reads result.data nested vectors", () => {
    const parsed = parseEmbeddingVectors({ result: { data: [vector(0.3)] } }, 1);
    expect(parsed[0][0]).toBe(0.3);
  });

  it("fails closed on the wrong count or width", () => {
    expect(() => parseEmbeddingVectors({ data: [{ embedding: vector(1) }] }, 2)).toThrow(
      /returned 1 vectors for 2/,
    );
    expect(() => parseEmbeddingVectors({ data: [{ embedding: [1, 2, 3] }] }, 1)).toThrow(
      /does not match 1024/,
    );
  });
});
