import { describe, expect, it } from "vitest";

import {
  DOCUMENT_EMBEDDING_INSTRUCTION,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_METRIC,
  EMBEDDING_MODEL,
  QUERY_EMBEDDING_INSTRUCTION,
  assertDistinctQueryAndDocumentPayloads,
  embeddingPayload,
} from "./instructions";

describe("embedding instructions", () => {
  it("keeps query and document Workers AI payloads distinct", () => {
    expect(DOCUMENT_EMBEDDING_INSTRUCTION).toBeNull();
    expect(QUERY_EMBEDDING_INSTRUCTION.length).toBeGreaterThan(20);
    expect(embeddingPayload({ kind: "documents", texts: ["refund policy"] })).toEqual({
      documents: ["refund policy"],
    });
    expect(embeddingPayload({ kind: "query", text: "refund policy" })).toEqual({
      queries: ["refund policy"],
      instruction: QUERY_EMBEDDING_INSTRUCTION,
    });
    expect(embeddingPayload({ kind: "query", text: "refund policy", instruction: "" })).toEqual({
      queries: ["refund policy"],
    });
    expect(() => assertDistinctQueryAndDocumentPayloads()).not.toThrow();
    expect(EMBEDDING_MODEL).toBe("@cf/qwen/qwen3-embedding-0.6b");
    expect(EMBEDDING_DIMENSIONS).toBe(1024);
    expect(EMBEDDING_METRIC).toBe("cosine");
  });
});
