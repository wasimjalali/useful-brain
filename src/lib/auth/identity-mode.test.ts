import { describe, expect, it } from "vitest";

import {
  IdentityConfigError,
  LoopbackIdentityError,
  assertedLoopbackAddress,
  assertIdentityConfiguration,
  isLoopbackAddress,
  parseIdentityMode,
} from "./identity-mode";

describe("identity modes", () => {
  it("parses the three mutually exclusive modes", () => {
    expect(parseIdentityMode("access")).toBe("access");
    expect(parseIdentityMode("loopback")).toBe("loopback");
    expect(parseIdentityMode("disabled")).toBe("disabled");
    expect(() => parseIdentityMode("asserted")).toThrow(IdentityConfigError);
  });

  it("allows loopback only in development", () => {
    expect(() =>
      assertIdentityConfiguration({
        runtimeEnv: "development",
        identityMode: "loopback",
        wranglerAccessDevConfigured: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertIdentityConfiguration({
        runtimeEnv: "staging",
        identityMode: "loopback",
        wranglerAccessDevConfigured: false,
      }),
    ).toThrow(/staging must use Access/);
    expect(() =>
      assertIdentityConfiguration({
        runtimeEnv: "production",
        identityMode: "disabled",
        wranglerAccessDevConfigured: false,
      }),
    ).toThrow(/production must use Access/);
  });

  it("fails staging and production when Wrangler access.dev is configured", () => {
    expect(() =>
      assertIdentityConfiguration({
        runtimeEnv: "staging",
        identityMode: "access",
        wranglerAccessDevConfigured: true,
      }),
    ).toThrow(/access.dev/);
  });

  it("recognises loopback addresses only", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("8.8.8.8")).toBe(false);
  });

  it("rejects forwarded address chains instead of trusting the first hop", () => {
    expect(() => assertedLoopbackAddress("127.0.0.1, 8.8.8.8")).toThrow(
      LoopbackIdentityError,
    );
    expect(() => assertedLoopbackAddress("8.8.8.8")).toThrow(LoopbackIdentityError);
    expect(assertedLoopbackAddress("127.0.0.1")).toBe("127.0.0.1");
    expect(assertedLoopbackAddress("::1")).toBe("::1");
  });
});
