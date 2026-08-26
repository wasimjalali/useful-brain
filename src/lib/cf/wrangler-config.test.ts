import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readJsonc(relativePath: string): Record<string, unknown> {
  const source = readFileSync(path.join(process.cwd(), relativePath), "utf8");
  expect(source).not.toMatch(/ACCESS_TEAM_DOMAIN|ACCESS_AUD/);
  return JSON.parse(source) as Record<string, unknown>;
}

function expectInternalWorker(target: Record<string, unknown>): void {
  expect(target.workers_dev).toBe(false);
  expect(target.preview_urls).toBe(false);
  expect(target.route).toBeUndefined();
  expect(target.routes).toBeUndefined();
}

describe("protected Worker configuration", () => {
  it("keeps Brain off workers.dev in every environment, including loopback", () => {
    const config = readJsonc("workers/brain/wrangler.jsonc");
    expect(config.dev).toEqual({ ip: "127.0.0.1" });
    expect(config.compatibility_flags).toEqual(
      expect.arrayContaining(["nodejs_compat", "global_fetch_strictly_public"]),
    );
    expectInternalWorker(config);
    const environments = config.env as Record<string, Record<string, unknown>>;
    for (const name of ["development", "staging", "production"]) {
      const env = environments[name];
      expectInternalWorker(env);
      const vars = env.vars as Record<string, string>;
      expect(vars).not.toHaveProperty("ACCESS_TEAM_DOMAIN");
      expect(vars).not.toHaveProperty("ACCESS_AUD");
      if (name === "development") {
        expect(vars.LOOPBACK_RUNTIME).toBe("true");
      } else {
        expect(vars.LOOPBACK_RUNTIME).not.toBe("true");
        expect(vars.LOOPBACK_SUBJECT ?? "").toBe("");
      }
    }
  });

  it("keeps Web off workers.dev until an Access route exists", () => {
    const config = readJsonc("wrangler.jsonc");
    expectInternalWorker(config);
    const environments = config.env as Record<string, Record<string, unknown>>;
    for (const name of ["development", "staging", "production"]) {
      expectInternalWorker(environments[name]);
    }
    expect((environments.staging.vars as Record<string, string>).LOOPBACK_RUNTIME).toBe("false");
    expect((environments.production.vars as Record<string, string>).IDENTITY_MODE).toBe("access");
  });

  it("web whoami route forwards only through the Brain Service Binding helper", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/brain/whoami/route.ts"), "utf8");
    expect(source).toMatch(/forwardIdentityToBrain/);
    expect(source).toMatch(/getCloudflareContext/);
    expect(source).not.toMatch(/x-useful-brain-principal/);
  });

  it("keeps Ingestion off workers.dev in every environment", () => {
    const config = readJsonc("workers/ingestion/wrangler.jsonc");
    expect(config.dev).toEqual({ ip: "127.0.0.1" });
    expect(config.compatibility_flags).toEqual(
      expect.arrayContaining(["nodejs_compat", "global_fetch_strictly_public"]),
    );
    expectInternalWorker(config);
    const environments = config.env as Record<string, Record<string, unknown>>;
    for (const name of ["development", "staging", "production"]) {
      const env = environments[name];
      expect(env.workers_dev).toBe(false);
      expect(env.preview_urls).toBe(false);
      expect(env.route).toBeUndefined();
      expect(env.routes).toBeUndefined();
      expect(env.services).toBeUndefined();
    }
  });
});
