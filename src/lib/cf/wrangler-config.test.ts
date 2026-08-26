import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readJsonc(relativePath: string): Record<string, unknown> {
  const source = readFileSync(path.join(process.cwd(), relativePath), "utf8");
  expect(source).not.toMatch(/ACCESS_TEAM_DOMAIN|ACCESS_AUD/);
  return JSON.parse(source) as Record<string, unknown>;
}

describe("protected Worker configuration", () => {
  it("keeps Brain staging and production internal and secret-free", () => {
    const config = readJsonc("workers/brain/wrangler.jsonc");
    expect(config.dev).toEqual({ ip: "127.0.0.1" });
    expect(config.compatibility_flags).toEqual(
      expect.arrayContaining(["nodejs_compat", "global_fetch_strictly_public"]),
    );
    const environments = config.env as Record<string, Record<string, unknown>>;
    for (const name of ["staging", "production"]) {
      const env = environments[name];
      expect(env.workers_dev).toBe(false);
      expect(env.preview_urls).toBe(false);
      expect(env.route).toBeUndefined();
      expect(env.routes).toBeUndefined();
      const vars = env.vars as Record<string, string>;
      expect(vars).not.toHaveProperty("ACCESS_TEAM_DOMAIN");
      expect(vars).not.toHaveProperty("ACCESS_AUD");
      expect(vars.LOOPBACK_RUNTIME).not.toBe("true");
      expect(vars.LOOPBACK_SUBJECT ?? "").toBe("");
    }
  });

  it("keeps Web staging and production off workers.dev until an Access route exists", () => {
    const config = readJsonc("wrangler.jsonc");
    const environments = config.env as Record<string, Record<string, unknown>>;
    for (const name of ["staging", "production"]) {
      const env = environments[name];
      expect(env.workers_dev).toBe(false);
      expect(env.preview_urls).toBe(false);
      const vars = env.vars as Record<string, string>;
      expect(vars.LOOPBACK_RUNTIME).toBe("false");
      expect(vars.IDENTITY_MODE).toBe("access");
    }
  });

  it("web whoami route forwards only through the Brain Service Binding helper", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/brain/whoami/route.ts"), "utf8");
    expect(source).toMatch(/forwardIdentityToBrain/);
    expect(source).toMatch(/getCloudflareContext/);
    expect(source).not.toMatch(/x-useful-brain-principal/);
  });

  it("keeps Ingestion staging and production internal", () => {
    const config = readJsonc("workers/ingestion/wrangler.jsonc");
    expect(config.dev).toEqual({ ip: "127.0.0.1" });
    expect(config.compatibility_flags).toEqual(
      expect.arrayContaining(["nodejs_compat", "global_fetch_strictly_public"]),
    );
    const environments = config.env as Record<string, Record<string, unknown>>;
    for (const name of ["staging", "production"]) {
      const env = environments[name];
      expect(env.workers_dev).toBe(false);
      expect(env.preview_urls).toBe(false);
      expect(env.route).toBeUndefined();
      expect(env.routes).toBeUndefined();
      expect(env.services).toBeUndefined();
    }
  });
});
