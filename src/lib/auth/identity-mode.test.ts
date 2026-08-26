import { describe, expect, it } from "vitest";

import {
  IdentityConfigError,
  assertIdentityConfiguration,
  parseIdentityMode,
} from "./identity-mode";

describe("identity modes", () => {
  it("parses the three mutually exclusive modes", () => {
    expect(parseIdentityMode("access")).toBe("access");
    expect(parseIdentityMode("loopback")).toBe("loopback");
    expect(parseIdentityMode("disabled")).toBe("disabled");
    expect(() => parseIdentityMode("asserted")).toThrow(IdentityConfigError);
  });

  it("allows loopback only in development with the trusted runtime signal", () => {
    expect(() =>
      assertIdentityConfiguration({
        runtimeEnv: "development",
        identityMode: "loopback",
        wranglerAccessDevConfigured: false,
        loopbackRuntimeConfigured: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertIdentityConfiguration({
        runtimeEnv: "development",
        identityMode: "loopback",
        wranglerAccessDevConfigured: false,
        loopbackRuntimeConfigured: false,
      }),
    ).toThrow(/LOOPBACK_RUNTIME/);
    expect(() =>
      assertIdentityConfiguration({
        runtimeEnv: "staging",
        identityMode: "loopback",
        wranglerAccessDevConfigured: false,
        loopbackRuntimeConfigured: true,
      }),
    ).toThrow(/staging must use Access/);
  });

  it("fails staging and production when Wrangler access.dev or loopback runtime is configured", () => {
    expect(() =>
      assertIdentityConfiguration({
        runtimeEnv: "staging",
        identityMode: "access",
        wranglerAccessDevConfigured: true,
        loopbackRuntimeConfigured: false,
      }),
    ).toThrow(/access.dev/);
    expect(() =>
      assertIdentityConfiguration({
        runtimeEnv: "production",
        identityMode: "access",
        wranglerAccessDevConfigured: false,
        loopbackRuntimeConfigured: true,
      }),
    ).toThrow(/loopback runtime/);
  });
});
