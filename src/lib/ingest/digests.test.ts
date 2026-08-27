import { describe, expect, it } from "vitest";

import {
  ACL_GROUP_WIDTH,
  GENERATION_NAMESPACE_WIDTH,
  VECTOR_ID_MAX_BYTES,
  contentDigest,
  generationNamespace,
  vectorIdForChunk,
} from "./digests";

describe("stable IDs and content digests", () => {
  it("maps a chunk id to a 40-hex Vectorize id under the 64-byte cap", async () => {
    const vectorId = await vectorIdForChunk("refund__germany__000");
    expect(vectorId).toMatch(/^[a-f0-9]{40}$/);
    expect(new TextEncoder().encode(vectorId).byteLength).toBeLessThanOrEqual(VECTOR_ID_MAX_BYTES);
    expect(await vectorIdForChunk("refund__germany__000")).toBe(vectorId);
    expect(await vectorIdForChunk("refund__germany__001")).not.toBe(vectorId);
  });

  it("hashes chunk text and generation ids to fixed-width values", async () => {
    expect(await contentDigest("RF-75")).toMatch(/^[a-f0-9]{64}$/);
    expect(await contentDigest("RF-75")).not.toBe(await contentDigest("RF-76"));
    const namespace = await generationNamespace("gen-1");
    expect(namespace).toHaveLength(GENERATION_NAMESPACE_WIDTH);
    expect(namespace).toHaveLength(ACL_GROUP_WIDTH);
  });
});
