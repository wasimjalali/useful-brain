import { describe, expect, it } from "vitest";

import { legacyRedirectTarget, LEGACY_REDIRECTS } from "./redirects";

describe("legacy redirects", () => {
  it("sends Sources and Evals to their admin routes", () => {
    expect(legacyRedirectTarget("/knowledge")).toBe("/admin/sources");
    expect(legacyRedirectTarget("/knowledge/new")).toBe("/admin/sources?upload=1");
    expect(legacyRedirectTarget("/evaluations")).toBe("/admin/evals");
  });

  it("keeps /settings as a deep link that opens the dialog over chat", () => {
    expect(legacyRedirectTarget("/settings")).toBe("/chat?settings=1");
  });

  it("ignores trailing slashes and unknown or inherited paths", () => {
    expect(legacyRedirectTarget("/knowledge/")).toBe("/admin/sources");
    expect(legacyRedirectTarget("/chat")).toBeNull();
    expect(legacyRedirectTarget("/open")).toBeNull();
    expect(legacyRedirectTarget("/knowledge/other")).toBeNull();
    expect(legacyRedirectTarget("/constructor")).toBeNull();
    expect(legacyRedirectTarget("/__proto__")).toBeNull();
  });

  it("never redirects to a legacy path", () => {
    for (const target of Object.values(LEGACY_REDIRECTS)) {
      expect(legacyRedirectTarget(target.split("?")[0])).toBeNull();
    }
  });
});
