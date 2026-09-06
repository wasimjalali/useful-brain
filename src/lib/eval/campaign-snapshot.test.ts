import { describe, expect, it } from "vitest";

import {
  campaignRun,
  formatPassRate,
  NORTHWIND_CAMPAIGN,
} from "./campaign-snapshot";

describe("NORTHWIND_CAMPAIGN", () => {
  it("records the latest 118/120 coverage run", () => {
    const latest = campaignRun(NORTHWIND_CAMPAIGN.latestKey);

    expect(latest.passed).toBe(118);
    expect(latest.scored).toBe(120);
    expect(latest.failures).toHaveLength(2);
    expect(NORTHWIND_CAMPAIGN.retrieval.aclLeaks).toBe(0);
    expect(formatPassRate(latest.passRate)).toBe("98%");
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
