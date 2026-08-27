import { describe, expect, it } from "vitest";

import {
  PROMOTE_SQL,
  UPSERT_CHUNK_SQL,
  canMarkReady,
  failGeneration,
  promote,
  rollback,
} from "./generations";

describe("corpus generations", () => {
  it("promotes and rolls back by pointer without Time Travel", () => {
    const ready = { id: "gen-2", state: "ready" as const };
    const previous = { id: "gen-1", state: "active" as const };
    expect(promote("gen-1", ready)).toEqual({ previousId: "gen-1", nextId: "gen-2" });
    expect(rollback("gen-2", previous)).toBe("gen-1");
    expect(() => promote("gen-1", { id: "gen-3", state: "indexing" })).toThrow(/ready/);
  });

  it("does not change the active pointer when a draft fails", () => {
    const failed = failGeneration({ id: "gen-9", state: "indexing" }, "gen-1");
    expect(failed.state).toBe("failed");
    expect(failed.id).not.toBe("gen-1");
    expect(() => failGeneration({ id: "gen-1", state: "indexing" }, "gen-1")).toThrow(
      /must not change the active generation pointer/,
    );
    expect(() => failGeneration({ id: "gen-1", state: "active" }, "gen-1")).toThrow(/active generation cannot fail/);
  });

  it("blocks ready when the audit is partial or the metadata index is missing", () => {
    expect(() =>
      canMarkReady({
        auditStatus: "partial",
        auditClean: false,
        metadataIndexReady: true,
        dimensions: 1024,
        expectedDimensions: 1024,
      }),
    ).toThrow(/partial or moving/);
    expect(() =>
      canMarkReady({
        auditStatus: "complete",
        auditClean: true,
        metadataIndexReady: false,
        dimensions: 1024,
        expectedDimensions: 1024,
      }),
    ).toThrow(/metadata index/);
    expect(() =>
      canMarkReady({
        auditStatus: "complete",
        auditClean: true,
        metadataIndexReady: true,
        dimensions: 1024,
        expectedDimensions: 1024,
      }),
    ).not.toThrow();
  });

  it("upserts chunks with ON CONFLICT DO UPDATE and never INSERT OR REPLACE", () => {
    expect(UPSERT_CHUNK_SQL).toMatch(/ON CONFLICT\(chunk_id\) DO UPDATE/);
    expect(UPSERT_CHUNK_SQL).not.toMatch(/INSERT\s+OR\s+REPLACE/i);
    expect(PROMOTE_SQL).toMatch(/state = 'ready'/);
  });
});
