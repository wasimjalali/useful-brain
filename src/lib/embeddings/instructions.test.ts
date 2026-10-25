import { describe, expect, it } from "vitest";

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_METRIC,
  EMBEDDING_MODEL,
  embeddingPayload,
} from "./instructions";

describe("embedding payloads", () => {
  it("sends documents and queries to BGE-M3 as contexts, with no instruction or query field", () => {
    expect(embeddingPayload({ kind: "documents", texts: ["refund policy", "leave policy"] })).toEqual({
      contexts: [{ text: "refund policy" }, { text: "leave policy" }],
    });
    expect(embeddingPayload({ kind: "query", text: "refund policy" })).toEqual({
      contexts: [{ text: "refund policy" }],
    });
    expect(EMBEDDING_MODEL).toBe("@cf/baai/bge-m3");
    expect(EMBEDDING_DIMENSIONS).toBe(1024);
    expect(EMBEDDING_METRIC).toBe("cosine");
  });
});
