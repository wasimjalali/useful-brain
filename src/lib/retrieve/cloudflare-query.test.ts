import { describe, expect, it } from "vitest";

import { GENERATION_NAMESPACE_WIDTH } from "../ingest/digests";
import { buildVectorizeQuery, RetrievalQueryError } from "./cloudflare-query";

describe("Cloudflare retrieval query", () => {
  it("requires generation namespace and acl_group together", async () => {
    await expect(buildVectorizeQuery({ generationId: "", aclGroupKeys: ["a".repeat(32)] })).rejects.toThrow(
      RetrievalQueryError,
    );
    const query = await buildVectorizeQuery({
      generationId: "gen-fts",
      aclGroupKeys: ["a".repeat(32), "b".repeat(32)],
    });
    expect(query.namespace).toHaveLength(GENERATION_NAMESPACE_WIDTH);
    expect(query.filter.acl_group.$in).toHaveLength(2);
  });

  it("refuses a serialized Vectorize filter at 2048 bytes", async () => {
    const keys = Array.from({ length: 80 }, (_, index) => index.toString(16).padStart(32, "0"));
    await expect(buildVectorizeQuery({ generationId: "gen-fts", aclGroupKeys: keys })).rejects.toThrow(/2048/);
  });
});
