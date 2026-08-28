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

  it("allows loopback in development and local production with the trusted runtime signal", () => {
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
    ).toThrow(/loopback runtime/);
    expect(() =>
      assertIdentityConfiguration({
        runtimeEnv: "staging",
        identityMode: "loopback",
        wranglerAccessDevConfigured: false,
        loopbackRuntimeConfigured: false,
      }),
    ).toThrow(/not allowed on staging/);
    expect(() =>
      assertIdentityConfiguration({
        runtimeEnv: "production",
        identityMode: "loopback",
        wranglerAccessDevConfigured: false,
        loopbackRuntimeConfigured: true,
      }),
    ).not.toThrow();
  });

  it("allows staging disabled identity without loopback or Access secrets", () => {
    expect(() =>
      assertIdentityConfiguration({
        runtimeEnv: "staging",
        identityMode: "disabled",
        wranglerAccessDevConfigured: false,
        loopbackRuntimeConfigured: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertIdentityConfiguration({
        runtimeEnv: "staging",
        identityMode: "disabled",
        wranglerAccessDevConfigured: false,
        loopbackRuntimeConfigured: true,
      }),
    ).toThrow(/loopback runtime/);
    expect(() =>
      assertIdentityConfiguration({
        runtimeEnv: "production",
        identityMode: "disabled",
        wranglerAccessDevConfigured: false,
        loopbackRuntimeConfigured: false,
      }),
    ).toThrow(/production cannot use disabled identity/);
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
    ).toThrow(/loopback runtime signal/);
  });
});
