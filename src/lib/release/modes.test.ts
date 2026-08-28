import { describe, expect, it } from "vitest";

import { rollback } from "../store/generations";
import {
  FAIL_CLOSED_INCIDENTS,
  GROSS_USAGE_CEILINGS_USD,
  assertSyntheticRelease,
  assertWithinGrossCeiling,
  measureHealthLoad,
  planRelease,
} from "./modes";

describe("synthetic Cloudflare release plans", () => {
  it("keeps Cloudflare as the live backend in every mode", () => {
    expect(planRelease("shadow")).toEqual({
      mode: "shadow",
      liveBackend: "cloudflare",
      syntheticOnly: true,
      canaryPercent: 0,
    });
    expect(planRelease("canary")).toMatchObject({ liveBackend: "cloudflare", canaryPercent: 10 });
    const primary = planRelease("staging_primary");
    expect(primary.liveBackend).toBe("cloudflare");
    expect(primary.canaryPercent).toBe(100);
    for (const mode of ["shadow", "canary", "staging_primary"] as const) {
      assertSyntheticRelease(planRelease(mode));
    }
  });

  it("rolls back by generation pointer, not Time Travel", () => {
    expect(rollback("gen-2", { id: "gen-1", state: "active" })).toBe("gen-1");
  });

  it("records fail-closed incidents and the gross usage ceilings", () => {
    expect(FAIL_CLOSED_INCIDENTS).toContain("invalid citation");
    expect(FAIL_CLOSED_INCIDENTS).toContain("revoked connector");
    expect(GROSS_USAGE_CEILINGS_USD).toEqual({ cloudflare: 25, models: 75, combined: 100 });
    expect(() => assertWithinGrossCeiling({ cloudflare: 0, models: 0 })).not.toThrow();
    expect(() => assertWithinGrossCeiling({ cloudflare: 26, models: 0 })).toThrow(/Cloudflare/);
  });

  it("measures a synthetic health load", async () => {
    const result = await measureHealthLoad({
      url: "https://useful-brain-staging.karko-ai.workers.dev/api/health",
      n: 8,
      fetchImpl: async () => new Response("ok", { status: 200 }),
    });
    expect(result.ok).toBe(8);
    expect(result.failed).toBe(0);
    expect(result.durationsMs).toHaveLength(8);
  });
});
