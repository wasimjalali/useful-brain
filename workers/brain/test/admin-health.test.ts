import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import {
  HEALTH_DETAIL_CODES,
  type HealthResponse,
  type HealthRow,
} from "../../../src/lib/contracts/admin-metrics";
import { recordedAiRun } from "../../../src/lib/models/ai-health";
import { recordAudit } from "../../../src/lib/store/corpus-d1";
import { recordServiceHealth } from "../../../src/lib/store/service-health";
import { call, personaCookies } from "./admin-helpers";
import { seedCorpus } from "./seed";

let cookies: Awaited<ReturnType<typeof personaCookies>>;
let generationId: string;

async function health(): Promise<HealthRow[]> {
  const response = await call("/admin/health", cookies["member-jordan"]);
  expect(response.status).toBe(200);
  return ((await response.json()) as HealthResponse).services;
}

function row(rows: HealthRow[], service: string): HealthRow {
  const found = rows.find((item) => item.service === service);
  expect(found, service).toBeDefined();
  return found!;
}

beforeAll(async () => {
  cookies = await personaCookies();
  generationId = (await seedCorpus()).generationId;
});

describe("GET /admin/health", () => {
  it("needs a session", async () => {
    expect((await call("/admin/health")).status).toBe(401);
  });

  it("refuses a member", async () => {
    expect((await call("/admin/health", cookies["member-maya"])).status).toBe(403);
  });

  it("warns when the active generation has no reconciliation audit and no AI call yet", async () => {
    await env.CORPUS_DB.prepare(`DELETE FROM reconciliation_audits`).run();
    const rows = await health();
    expect(row(rows, "brain")).toMatchObject({ status: "ok", detail: "ok" });
    expect(row(rows, "corpus_db")).toMatchObject({ status: "ok", detail: "ok" });
    expect(row(rows, "vector_index")).toMatchObject({ status: "warning", detail: "no_audit", generationId });
    expect(row(rows, "workers_ai")).toMatchObject({ status: "warning", detail: "no_calls_yet" });
  });

  it("always reports AI Gateway as not in the call path", async () => {
    expect(row(await health(), "ai_gateway")).toMatchObject({
      status: "warning",
      detail: "not_in_call_path",
    });
  });

  it("reports a partial audit as a warning and drift as an error", async () => {
    await recordAudit(
      env.CORPUS_DB,
      generationId,
      { status: "partial", missingVectors: [], orphanVectors: [] } as never,
    );
    expect(row(await health(), "vector_index")).toMatchObject({ status: "warning", detail: "audit_partial" });
    await recordAudit(
      env.CORPUS_DB,
      generationId,
      { status: "complete", missingVectors: ["v1"], orphanVectors: [] } as never,
    );
    expect(row(await health(), "vector_index")).toMatchObject({ status: "error", detail: "drift" });
  });

  it("reports a clean complete audit as synced", async () => {
    await recordAudit(
      env.CORPUS_DB,
      generationId,
      { status: "complete", missingVectors: [], orphanVectors: [] } as never,
    );
    expect(row(await health(), "vector_index")).toMatchObject({
      status: "ok",
      detail: "synced",
      generationId,
    });
  });

  it("still answers, with an unreachable vector index, when the audit query itself fails", async () => {
    await env.CORPUS_DB.prepare(`ALTER TABLE reconciliation_audits RENAME TO reconciliation_audits_hidden`).run();
    try {
      const rows = await health();
      expect(row(rows, "corpus_db")).toMatchObject({ status: "ok" });
      expect(row(rows, "vector_index")).toMatchObject({ status: "error", detail: "unreachable" });
    } finally {
      await env.CORPUS_DB.prepare(`ALTER TABLE reconciliation_audits_hidden RENAME TO reconciliation_audits`).run();
    }
  });

  it("takes Workers AI from the latest health event", async () => {
    await recordServiceHealth(env.OPERATIONS_DB, { service: "workers_ai", status: "ok", code: "last_call_ok", at: 1000 });
    expect(row(await health(), "workers_ai")).toMatchObject({ status: "ok", detail: "last_call_ok", at: 1000 });
    await recordServiceHealth(env.OPERATIONS_DB, { service: "workers_ai", status: "error", code: "timeout", at: 2000 });
    expect(row(await health(), "workers_ai")).toMatchObject({ status: "error", detail: "timeout" });
  });

  it("only ever returns closed detail codes", async () => {
    await env.OPERATIONS_DB
      .prepare(
        `INSERT INTO service_health_events (service, status, code, at) VALUES ('workers_ai', 'error', 'raw provider message: secret', 3000)`,
      )
      .run();
    for (const item of await health()) {
      expect(HEALTH_DETAIL_CODES as readonly string[]).toContain(item.detail);
    }
    expect(row(await health(), "workers_ai").detail).toBe("last_call_failed");
  });
});

describe("recordedAiRun", () => {
  it("records ok and returns the value", async () => {
    const value = await recordedAiRun(env.OPERATIONS_DB, async () => 42, () => 5000);
    expect(value).toBe(42);
    expect(row(await health(), "workers_ai")).toMatchObject({ status: "ok", at: 5000 });
  });

  it("records the failure code and rethrows the original error", async () => {
    const boom = new Error("request timed out");
    await expect(
      recordedAiRun(env.OPERATIONS_DB, async () => Promise.reject(boom), () => 6000),
    ).rejects.toBe(boom);
    expect(row(await health(), "workers_ai")).toMatchObject({ status: "error", detail: "timeout", at: 6000 });
  });

  it("records a timeout when the call rejects with AbortError after a TimeoutError signal fired", async () => {
    const signal = AbortSignal.timeout(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const aborted = new DOMException("aborted", "AbortError");
    await expect(
      recordedAiRun(env.OPERATIONS_DB, async () => Promise.reject(aborted), () => 7000, { signal }),
    ).rejects.toBe(aborted);
    expect(row(await health(), "workers_ai")).toMatchObject({ status: "error", detail: "timeout", at: 7000 });
  });

  it("does not hide the model result when the health write fails", async () => {
    const broken = { prepare: () => { throw new Error("db down"); } } as never;
    await expect(recordedAiRun(broken, async () => "fine")).resolves.toBe("fine");
  });
});
