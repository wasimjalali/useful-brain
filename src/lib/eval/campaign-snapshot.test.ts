import { describe, expect, it } from "vitest";

import {
  campaignRun,
  formatPassRate,
  NORTHWIND_CAMPAIGN,
} from "./campaign-snapshot";

describe("NORTHWIND_CAMPAIGN", () => {
  it("records the latest 117/120 run of 8 Oct 2026", () => {
    const latest = campaignRun(NORTHWIND_CAMPAIGN.latestKey);

    expect(latest.date).toBe("2026-10-08");
    expect(latest.passed).toBe(117);
    expect(latest.scored).toBe(120);
    expect(latest.failures.map((f) => f.id)).toEqual(["q073", "q086", "q090"]);
    expect(latest.categories.map((c) => [c.id, c.passed, c.scored])).toEqual([
      ["factual", 70, 70],
      ["trap", 17, 17],
      ["permission", 12, 13],
      ["unanswerable", 10, 10],
      ["multi_hop", 8, 10],
    ]);
    expect(NORTHWIND_CAMPAIGN.retrieval.aclLeaks).toBe(0);
    expect(formatPassRate(latest.passRate)).toBe("98%");
  });

  it("keeps the 118/120 coverage run and the 115/120 redesign build", () => {
    expect(campaignRun("coverage").passed).toBe(118);
    expect(campaignRun("redesign").passed).toBe(115);
    expect(NORTHWIND_CAMPAIGN.runs.map((r) => r.key)).toEqual([
      "baseline", "pass1", "final", "coverage", "redesign", "latest",
    ]);
  });

  it("keeps the locked 114/120 pass-2 run", () => {
    const pass2 = campaignRun("final");

    expect(pass2.passed).toBe(114);
    expect(pass2.scored).toBe(120);
    expect(pass2.failures).toHaveLength(6);
    expect(formatPassRate(pass2.passRate)).toBe("95%");
  });

  it("keeps the 72% baseline and 79.2% honest pass", () => {
    expect(campaignRun("baseline").passRate).toBe(0.72);
    expect(formatPassRate(campaignRun("pass1").passRate)).toBe("79.2%");
  });
});
