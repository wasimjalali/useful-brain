import { describe, expect, it } from "vitest";

import {
  canAdvanceTurnStage,
  isTurnProgressCount,
  isTurnStage,
  normalizeTurnStage,
  TURN_STAGES,
  turnFailureCode,
  turnStageCount,
} from "./turn-progress";

describe("turn progress stage enum", () => {
  it("accepts exactly the three host-controlled stages", () => {
    expect(TURN_STAGES).toEqual(["searching", "reading", "writing"]);
    for (const stage of TURN_STAGES) {
      expect(isTurnStage(stage)).toBe(true);
    }
  });

  it("rejects terminal labels, old names, empty input and free text", () => {
    for (const value of [
      "done",
      "failed",
      "streaming",
      "drafting",
      "Searching",
      "",
      " searching",
      null,
      undefined,
      1,
      {},
      ["searching"],
    ]) {
      expect(isTurnStage(value)).toBe(false);
    }
  });

  it("maps old stage names onto writing and nothing else", () => {
    for (const legacy of ["drafting", "checking_citations", "saving"]) {
      expect(normalizeTurnStage(legacy)).toBe("writing");
    }
    for (const stage of TURN_STAGES) {
      expect(normalizeTurnStage(stage)).toBe(stage);
    }
    for (const value of ["done", "toString", "__proto__", "", null, 3]) {
      expect(normalizeTurnStage(value)).toBeNull();
    }
  });
});

describe("turn progress counts", () => {
  it("accepts integers 0..100000 only", () => {
    for (const ok of [0, 1, 99, 100000]) {
      expect(isTurnProgressCount(ok)).toBe(true);
    }
    for (const bad of [-1, 1.5, 100001, Number.NaN, Infinity, "3", null, undefined, {}]) {
      expect(isTurnProgressCount(bad)).toBe(false);
    }
  });

  it("counted stages need a count and writing takes none", () => {
    expect(turnStageCount("searching", 4)).toBe(4);
    expect(turnStageCount("reading", 0)).toBe(0);
    expect(turnStageCount("searching", undefined)).toBeUndefined();
    expect(turnStageCount("reading", 1.2)).toBeUndefined();
    expect(turnStageCount("writing", undefined)).toBeNull();
    expect(turnStageCount("writing", null)).toBeNull();
    expect(turnStageCount("writing", 3)).toBeUndefined();
  });
});

describe("turn stage transitions", () => {
  it("advances monotonically and allows an idempotent repeat", () => {
    expect(canAdvanceTurnStage(null, "searching")).toBe(true);
    expect(canAdvanceTurnStage("searching", "searching")).toBe(true);
    expect(canAdvanceTurnStage("searching", "reading")).toBe(true);
    expect(canAdvanceTurnStage("reading", "writing")).toBe(true);
    expect(canAdvanceTurnStage("searching", "writing")).toBe(true);
  });

  it("rejects backward movement", () => {
    expect(canAdvanceTurnStage("reading", "searching")).toBe(false);
    expect(canAdvanceTurnStage("writing", "reading")).toBe(false);
  });
});

describe("turn failure codes", () => {
  it("preserves the stored public codes", () => {
    for (const code of [
      "CANCELLED",
      "RATE_LIMITED",
      "PROVIDER_TEMPORARY",
      "VALIDATION_FAILED",
      "INTERNAL_ERROR",
    ]) {
      expect(turnFailureCode(code)).toBe(code);
    }
  });

  it("fails closed to INTERNAL_ERROR on missing or unknown codes", () => {
    for (const value of [null, undefined, "", "STACK_TRACE", "pg::error"]) {
      expect(turnFailureCode(value)).toBe("INTERNAL_ERROR");
    }
  });
});
