import { describe, expect, it } from "vitest";

import { auditStoreConsistency } from "./inventory-audit";
import { canMarkReady } from "./generations";

describe("inventory audit", () => {
  it("is unsupported when the store cannot list exact Vectorize IDs", () => {
    const report = auditStoreConsistency({});
    expect(report.status).toBe("unsupported");
    expect(report.clean).toBe(false);
  });

  it("maps missing vector ids to chunk ids and keeps orphan digests raw", () => {
    const report = auditStoreConsistency({
      inventoryWatermark: () => "mut-1",
      expectedVectorIds: () => ({ abc: "chunk-a", def: "chunk-b" }),
      vectorIds: () => ["abc", "zzz"],
    });
    expect(report.status).toBe("complete");
    expect(report.missingVectors).toEqual(["chunk-b"]);
    expect(report.orphanVectors).toEqual(["zzz"]);
    expect(report.clean).toBe(false);
  });

  it("marks a moving or watermark-less inventory as partial and blocks promotion", () => {
    let watermark = "mut-1";
    const moving = auditStoreConsistency({
      inventoryWatermark: () => {
        const current = watermark;
        watermark = "mut-2";
        return current;
      },
      expectedVectorIds: () => ({ abc: "chunk-a" }),
      vectorIds: () => ["abc"],
    });
    expect(moving.status).toBe("partial");
    expect(() =>
      canMarkReady({
        auditStatus: moving.status,
        auditClean: moving.clean,
        metadataIndexReady: true,
        dimensions: 1024,
        expectedDimensions: 1024,
      }),
    ).toThrow(/partial or moving/);

    const noWatermark = auditStoreConsistency({
      inventoryWatermark: () => null,
      expectedVectorIds: () => ({ abc: "chunk-a" }),
      vectorIds: () => ["abc"],
    });
    expect(noWatermark.status).toBe("partial");

    const empty = auditStoreConsistency({
      inventoryWatermark: () => null,
      expectedVectorIds: () => ({}),
      vectorIds: () => [],
    });
    expect(empty.status).toBe("complete");
    expect(empty.clean).toBe(true);
  });
});
