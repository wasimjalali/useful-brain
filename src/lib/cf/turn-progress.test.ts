import { describe, expect, it } from "vitest";

import {
  canAdvanceTurnStage,
  isTurnStage,
  TURN_STAGES,
  turnFailureCode,
} from "./turn-progress";

describe("turn progress stage enum", () => {
  it("accepts exactly the four host-controlled stages", () => {
    expect(TURN_STAGES).toEqual([
      "searching",
      "drafting",
      "checking_citations",
      "saving",
    ]);
    for (const stage of TURN_STAGES) {
      expect(isTurnStage(stage)).toBe(true);
    }
  });

  it("rejects terminal labels, empty input and free text", () => {
    for (const value of [
      "done",
      "failed",
      "streaming",
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
});

describe("turn stage transitions", () => {
  it("advances monotonically and allows an idempotent repeat", () => {
    expect(canAdvanceTurnStage(null, "searching")).toBe(true);
    expect(canAdvanceTurnStage("searching", "searching")).toBe(true);
    expect(canAdvanceTurnStage("searching", "drafting")).toBe(true);
    expect(canAdvanceTurnStage("drafting", "checking_citations")).toBe(true);
    expect(canAdvanceTurnStage("checking_citations", "saving")).toBe(true);
  });

  it("rejects backward movement", () => {
    expect(canAdvanceTurnStage("drafting", "searching")).toBe(false);
    expect(canAdvanceTurnStage("saving", "checking_citations")).toBe(false);
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
