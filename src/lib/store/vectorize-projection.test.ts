import { describe, expect, it } from "vitest";

import {
  assertFilterSize,
  assertMetadataIndexReady,
  assertVectorizeQuery,
  mutationReached,
  newestMutationId,
  paginateVectorIds,
} from "./vectorize-projection";

describe("Vectorize projection", () => {
  it("waits for exact equality on the newest opaque mutation id", () => {
    expect(newestMutationId(["a", "b", "c"])).toBe("c");
    expect(mutationReached("c", "c")).toBe(true);
    expect(mutationReached("c", "d")).toBe(false);
    expect(mutationReached("c", null)).toBe(false);
  });

  it("requires generation namespace and acl_group, and refuses queries before the metadata index exists", () => {
    expect(() => assertVectorizeQuery({})).toThrow(/generation namespace/);
    expect(() => assertVectorizeQuery({ namespace: "ns" })).toThrow(/acl_group/);
    expect(() =>
      assertVectorizeQuery({ namespace: "ns", filter: { acl_group: { $in: ["abc"] } } }),
    ).not.toThrow();
    expect(() => assertMetadataIndexReady(false, true)).toThrow(/metadata index/);
    expect(() => assertFilterSize("x".repeat(2048))).toThrow(/2048/);
  });

  it("enumerates a paginated Vectorize ID inventory", () => {
    expect(
      paginateVectorIds([
        { ids: ["a", "b"], isTruncated: true, nextCursor: "c1" },
        { ids: ["c"], isTruncated: false },
      ]),
    ).toEqual(["a", "b", "c"]);
    expect(() => paginateVectorIds([{ ids: ["a"], isTruncated: true }])).toThrow(/nextCursor/);
  });
});
