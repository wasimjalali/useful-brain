import { describe, expect, it } from "vitest";

import { CONFLICT_DETECTION, PARENT_EXPANSION, detectConflicts, expandParent } from "./parent-off";
import { FAKE_PROVIDER_FINGERPRINT, REAL_STACK_FINGERPRINT, fingerprintId } from "./fingerprint";

describe("locked retrieval fingerprint", () => {
  it("keeps parent expansion and conflict detection off", () => {
    expect(PARENT_EXPANSION).toBe("off");
    expect(CONFLICT_DETECTION).toBe("off");
    expect(expandParent("chunk")).toBe("chunk");
    expect(detectConflicts()).toEqual([]);
    expect(REAL_STACK_FINGERPRINT.parentExpansion).toBe("off");
    expect(REAL_STACK_FINGERPRINT.conflictDetection).toBe("off");
  });

  it("locks the real-stack starting profile separately from the fake provider", () => {
    expect(REAL_STACK_FINGERPRINT).toMatchObject({
      maxTokens: 300,
      overlapTokens: 30,
      vectorWeight: 0.7,
      keywordWeight: 0.3,
      keywordCandidates: 6,
      rerankCandidates: 20,
      reranker: "@cf/baai/bge-reranker-base",
      relevanceFloor: 0.05,
      ftsMatchStrategy: "stopword-or-v1",
    });
    expect(FAKE_PROVIDER_FINGERPRINT.maxTokens).toBe(500);
    expect(FAKE_PROVIDER_FINGERPRINT.overlapTokens).toBe(50);
    expect(FAKE_PROVIDER_FINGERPRINT.vectorWeight).toBe(0.2);
    expect(FAKE_PROVIDER_FINGERPRINT.keywordWeight).toBe(0.8);
    expect(fingerprintId(FAKE_PROVIDER_FINGERPRINT)).toContain("500/50");
    expect(fingerprintId(FAKE_PROVIDER_FINGERPRINT)).toContain("0.20/0.80");
    expect(fingerprintId(REAL_STACK_FINGERPRINT)).toContain("300/30");
    expect(fingerprintId(REAL_STACK_FINGERPRINT)).toContain("0.70/0.30");
    expect(fingerprintId(FAKE_PROVIDER_FINGERPRINT)).toContain("fts-stopword-or-v1");
    expect(fingerprintId(REAL_STACK_FINGERPRINT)).toContain("fts-stopword-or-v1");
    expect(fingerprintId(REAL_STACK_FINGERPRINT)).not.toBe(fingerprintId(FAKE_PROVIDER_FINGERPRINT));
  });
});
