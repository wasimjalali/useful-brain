export type AuditStatus = "complete" | "unsupported" | "partial";

export type ConsistencyReport = {
  missingVectors: string[];
  orphanVectors: string[];
  status: AuditStatus;
  reason: string | null;
  expectedCount: number;
  actualCount: number;
  startWatermark: string | null;
  endWatermark: string | null;
  clean: boolean;
};

export type InventoryStore = {
  inventoryWatermark(): string | null;
  expectedVectorIds(): Record<string, string>;
  vectorIds(): string[];
};

const AUDIT_METHODS = ["inventoryWatermark", "expectedVectorIds", "vectorIds"] as const;

export function auditStoreConsistency(store: Partial<InventoryStore>): ConsistencyReport {
  const missingMethods = AUDIT_METHODS.filter((name) => typeof store[name] !== "function");
  if (missingMethods.length > 0) {
    return report({
      status: "unsupported",
      reason: `store lacks exact vector inventory capability: ${missingMethods.join(", ")}`,
    });
  }
  const capable = store as InventoryStore;
  const startWatermark = capable.inventoryWatermark();
  const expectedBefore = capable.expectedVectorIds();
  const actualIds = capable.vectorIds();
  const expectedAfter = capable.expectedVectorIds();
  const endWatermark = capable.inventoryWatermark();
  const expectedIds = new Set(Object.keys(expectedBefore));
  const actual = new Set(actualIds);
  const missing = [...expectedIds].filter((id) => !actual.has(id)).sort();
  const result = report({
    missingVectors: missing.map((id) => expectedBefore[id]).sort(),
    orphanVectors: [...actual].filter((id) => !expectedIds.has(id)).sort(),
    status: "complete",
    expectedCount: Object.keys(expectedBefore).length,
    actualCount: actualIds.length,
    startWatermark: startWatermark === null ? null : String(startWatermark),
    endWatermark: endWatermark === null ? null : String(endWatermark),
  });
  if (
    (Object.keys(expectedBefore).length > 0 || actualIds.length > 0 || Object.keys(expectedAfter).length > 0) &&
    (startWatermark === null || endWatermark === null)
  ) {
    result.status = "partial";
    result.reason = "non-empty Vectorize inventory has no processed mutation watermark";
    result.clean = false;
  } else if (!sameMap(expectedBefore, expectedAfter) || startWatermark !== endWatermark) {
    result.status = "partial";
    result.reason = "D1 or Vectorize changed during audit; retry in a quiet window";
    result.clean = false;
  }
  return result;
}

function sameMap(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => left[key] === right[key]);
}

function report(partial: Partial<ConsistencyReport>): ConsistencyReport {
  const next: ConsistencyReport = {
    missingVectors: [],
    orphanVectors: [],
    status: "unsupported",
    reason: null,
    expectedCount: 0,
    actualCount: 0,
    startWatermark: null,
    endWatermark: null,
    clean: false,
    ...partial,
  };
  next.clean =
    next.status === "complete" &&
    next.missingVectors.length === 0 &&
    next.orphanVectors.length === 0;
  return next;
}
