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
      if (name === "staging") {
        expect(vars.IDENTITY_MODE).toBe("session");
        expect(vars.RESOURCES_PROVISIONED).toBe("true");
        const databases = env.d1_databases as Array<{ database_id: string; database_name: string }>;
        expect(databases.map((db) => db.database_name).sort()).toEqual([
          "useful-brain-corpus-staging",
          "useful-brain-operations-staging",
        ]);
        for (const db of databases) {
          expect(db.database_id).not.toMatch(/^00000000-/);
        }
      }
      if (name === "production") {
        expect(vars.IDENTITY_MODE).toBe("session");
        expect(vars.RESOURCES_PROVISIONED).toBe("false");
      }
    }
  });

  it("gives every approval-resume consumer a dedicated dead-letter queue", () => {
    const config = readJsonc("workers/brain/wrangler.jsonc");
    const inspect = (target: Record<string, unknown>) => {
      const queues = target.queues as {
        consumers?: Array<{ queue: string; dead_letter_queue?: string }>;
      };
      const consumers = queues.consumers ?? [];
      const primary = consumers.filter(
        (consumer) =>
          consumer.queue.includes("approval-resume") && !consumer.queue.includes("dlq"),
      );
      expect(primary.length).toBeGreaterThan(0);
      for (const consumer of primary) {
        expect(consumer.dead_letter_queue).toMatch(/^useful-brain-approval-resume-dlq-/);
        expect(consumer.dead_letter_queue).not.toBe(consumer.queue);
      }
      const deadLetters = consumers.filter((consumer) =>
        consumer.queue.includes("approval-resume-dlq"),
      );
      expect(deadLetters).toHaveLength(primary.length);
    };
    inspect(config);
    const environments = config.env as Record<string, Record<string, unknown>>;
    for (const name of ["development", "staging", "production"]) {
      inspect(environments[name]);
    }
  });

  it("schedules bounded approval-resume reconciliation on loopback and staging only", () => {
    const config = readJsonc("workers/brain/wrangler.jsonc");
    const source = readFileSync(path.join(process.cwd(), "workers/brain/src/index.ts"), "utf8");
    expect(source).toMatch(/async scheduled\(/);
    expect(source).toMatch(/enqueueRecoverableApprovalResumes/);
    const inspect = (target: Record<string, unknown>, crons: string[]) => {
      const triggers = target.triggers as { crons?: string[] };
      expect(triggers.crons).toEqual(crons);
    };
    inspect(config, ["*/5 * * * *"]);
    const environments = config.env as Record<string, Record<string, unknown>>;
    inspect(environments.development, ["*/5 * * * *"]);
    inspect(environments.staging, ["*/5 * * * *"]);
    inspect(environments.production, []);
  });

  it("exposes only staging Web on workers.dev and keeps loopback off that URL", () => {
    const config = readJsonc("wrangler.jsonc");
    expectInternalWorker(config);
    const environments = config.env as Record<string, Record<string, unknown>>;
    expectInternalWorker(environments.development);
    expectInternalWorker(environments.production);
    expect(environments.staging.workers_dev).toBe(true);
    expect(environments.staging.preview_urls).toBe(false);
    expect(environments.staging.route).toBeUndefined();
    expect(environments.staging.routes).toBeUndefined();
    const stagingVars = environments.staging.vars as Record<string, string>;
    expect(stagingVars.IDENTITY_MODE).toBe("session");
    expect(stagingVars.LOOPBACK_RUNTIME).toBe("false");
    expect(stagingVars.WRANGLER_ACCESS_DEV).toBe("false");
    expect(stagingVars.RESOURCES_PROVISIONED).toBe("true");
    expect((environments.production.vars as Record<string, string>).IDENTITY_MODE).toBe("session");
  });

  it("sends public hosts to the landing page and keeps loopback on the workspace", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
    expect(source).toMatch(/getCloudflareContext/);
    expect(source).toMatch(/LOOPBACK_RUNTIME/);
    expect(source).toMatch(/IDENTITY_MODE/);
    expect(source).toMatch(/redirect\("\/open"\)/);
    expect(source).toMatch(/redirect\("\/login"\)/);
    expect(source).toMatch(/\/chat/);
    expect(source).toMatch(/\/knowledge/);
  });

  it("web whoami route forwards only through the Brain Service Binding helper", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/brain/whoami/route.ts"), "utf8");
    expect(source).toMatch(/forwardIdentityToBrain/);
    expect(source).toMatch(/getCloudflareContext/);
    expect(source).not.toMatch(/x-useful-brain-principal/);
  });

  it("uses remote Workers AI and Vectorize in development and deployed bindings elsewhere", () => {
    const config = readJsonc("workers/brain/wrangler.jsonc");
    expect(config.ai).toEqual({ binding: "AI", remote: true });
    expect(config.vectorize).toEqual([
      { binding: "VECTORIZE", index_name: "useful-brain-development", remote: true },
    ]);
    const environments = config.env as Record<string, Record<string, unknown>>;
    expect(environments.development.ai).toEqual({ binding: "AI", remote: true });
    expect(environments.development.vectorize).toEqual([
      { binding: "VECTORIZE", index_name: "useful-brain-development", remote: true },
    ]);
    expect(environments.staging.ai).toEqual({ binding: "AI" });
    expect(environments.staging.vectorize).toEqual([
      { binding: "VECTORIZE", index_name: "useful-brain-staging" },
    ]);
    expect(environments.production.ai).toEqual({ binding: "AI" });
    expect(environments.production.vectorize).toEqual([
      { binding: "VECTORIZE", index_name: "useful-brain-production" },
    ]);
  });

  it("web health route probes Brain over the Service Binding without identity headers", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/health/route.ts"), "utf8");
    expect(source).toMatch(/brain\.internal\/health/);
    expect(source).toMatch(/getCloudflareContext/);
    expect(source).not.toMatch(/cf-access-jwt-assertion|x-useful-brain-principal|LOOPBACK/);
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
      const vars = env.vars as Record<string, string>;
      if (name === "staging") {
        expect(vars.IDENTITY_MODE).toBe("disabled");
        expect(vars.LOOPBACK_RUNTIME).toBe("false");
        expect(vars.RESOURCES_PROVISIONED).toBe("true");
        const databases = env.d1_databases as Array<{ database_id: string }>;
        expect(databases[0]?.database_id).not.toMatch(/^00000000-/);
      }
      if (name === "production") {
        expect(vars.IDENTITY_MODE).toBe("access");
        expect(vars.RESOURCES_PROVISIONED).toBe("false");
      }
    }
  });

  it("applies local D1 migrations before the Cloudflare preview", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["db:local"]).toMatch(/useful-brain-corpus-development/);
    expect(pkg.scripts["db:local"]).toMatch(/useful-brain-operations-development/);
    expect(pkg.scripts["db:local"]).toMatch(/--persist-to \.wrangler\/state/);
    expect(pkg.scripts["preview:cf"]).toMatch(/npm run db:local/);
    expect(pkg.scripts["preview:cf"]).toMatch(/--persist-to \.wrangler\/state/);
    expect(pkg.scripts["eval:northwind"]).toMatch(/live-northwind-eval/);
  });

  it("reserves public usefulbuild hostnames on landing workers, not the operator app", () => {
    const brain = readJsonc("workers/public-hosts/brain/wrangler.jsonc");
    const voice = readJsonc("workers/public-hosts/voice/wrangler.jsonc");
    expect(brain.name).toBe("useful-brain-open");
    expect(voice.name).toBe("useful-voice");
    expect(brain.routes).toEqual([{ pattern: "brain.usefulbuild.com", custom_domain: true }]);
    expect(voice.routes).toEqual([{ pattern: "voice.usefulbuild.com", custom_domain: true }]);
    expect(brain.vars).toBeUndefined();
    expect(voice.vars).toBeUndefined();
  });

  it("ships the designed Brain landing on the public host", () => {
    const html = readFileSync(
      path.join(process.cwd(), "workers/public-hosts/brain/public/index.html"),
      "utf8",
    );
    expect(html).toContain("/brand/useful-brain-mark.svg");
    expect(html).toContain("/open/chat.png");
    expect(html).toContain("/open/sources.png");
    expect(html).toContain("/open/evals.png");
    expect(html).toContain("114/120");
    expect(html).toContain("/fonts/geist-variable.woff2");
    expect(html).toContain("https://usefulbuild.com");
    expect(html).toContain("https://cal.com/usefulbuild/free-audit");
    expect(html).toContain("Useful Brain, by Useful Build");
    expect(html).toContain('id="brain-sheet-grid"');
    expect(html).toContain('aria-current="page">Useful Brain');
    expect(html).toContain("https://github.com/wasimjalali/useful-brain");
    expect(html).toContain("View the source");
    expect(html).not.toContain(">Kursfind</a>");
    expect(html).not.toMatch(/LOOPBACK|Cloudflare Access|href=["']\/chat/i);
  });

  it("ships the Useful Build family system on the Voice landing", () => {
    const html = readFileSync(
      path.join(process.cwd(), "workers/public-hosts/voice/public/index.html"),
      "utf8",
    );
    expect(html).toContain("/brand/useful-voice-mark.svg");
    expect(html).toContain("Useful Voice, by Useful Build");
    expect(html).toContain('id="voice-sheet-grid"');
    expect(html).toContain('aria-current="page">Useful Voice');
    expect(html).toContain("https://usefulbuild.com");
    expect(html).not.toContain(">Kursfind</a>");
  });

  it("starts Cloud Agent terminals on Brain, not a Convex Next.js server", () => {
    const env = JSON.parse(
      readFileSync(path.join(process.cwd(), ".cursor/environment.json"), "utf8"),
    ) as { terminals: Array<{ name: string; command: string; description: string }> };
    expect(env.terminals.map((terminal) => terminal.name)).toEqual(["brain", "web"]);
    expect(env.terminals[0]?.command).toMatch(/brain-dev\.sh/);
    expect(JSON.stringify(env)).not.toMatch(/Convex/i);
  });
});
