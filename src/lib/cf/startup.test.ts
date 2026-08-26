import { describe, expect, it } from "vitest";

import { StartupConfigError, assertWorkerStartup } from "./startup";

describe("worker startup", () => {
  it("allows an unprovisioned development worker", () => {
    expect(
      assertWorkerStartup({
        RUNTIME_ENV: "development",
        IDENTITY_MODE: "loopback",
        RESOURCES_PROVISIONED: "false",
        WRANGLER_ACCESS_DEV: "false",
      }),
    ).toEqual({ runtimeEnv: "development", identityMode: "loopback" });
  });

  it("fails staging when resources are still placeholders", () => {
    expect(() =>
      assertWorkerStartup({
        RUNTIME_ENV: "staging",
        IDENTITY_MODE: "access",
        RESOURCES_PROVISIONED: "false",
        WRANGLER_ACCESS_DEV: "false",
      }),
    ).toThrow(StartupConfigError);
  });
});
