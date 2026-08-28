import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("IngestionWorkflow", () => {
  it("starts and executes bounded idempotent steps through ready", async () => {
    await using instance = await introspectWorkflowInstance(env.INGESTION_WORKFLOW, "wf-job-1");
    await env.INGESTION_WORKFLOW.create({
      id: "wf-job-1",
      params: { jobId: "wf-job-1", idempotencyKey: "wf-idem-1" },
    });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toEqual({
      jobId: "wf-job-1",
      idempotencyKey: "wf-idem-1",
      accepted: true,
      generationId: "wf-idem-1",
      state: "ready",
      auditStatus: "complete",
    });
    const step = await instance.waitForStepResult({ name: "accept-ingestion-job" });
    expect(step).toEqual({
      jobId: "wf-job-1",
      idempotencyKey: "wf-idem-1",
      accepted: true,
    });
    const draft = await instance.waitForStepResult({ name: "ensure-draft-generation" });
    expect(draft).toEqual({ generationId: "wf-idem-1", state: "draft" });
    const finalized = await instance.waitForStepResult({ name: "reconcile-and-finalize" });
    expect(finalized).toEqual({
      generationId: "wf-idem-1",
      state: "ready",
      auditStatus: "complete",
    });
  });

  it("resumes the same deterministic instance id without a second draft", async () => {
    await using instance = await introspectWorkflowInstance(env.INGESTION_WORKFLOW, "idem-resume");
    await env.INGESTION_WORKFLOW.create({
      id: "idem-resume",
      params: { jobId: "job-resume", idempotencyKey: "idem-resume" },
    });
    await instance.waitForStatus("complete");
    const resumed = await env.INGESTION_WORKFLOW.create({
      id: "idem-resume",
      params: { jobId: "job-resume", idempotencyKey: "idem-resume" },
    });
    expect(resumed.id).toBe("idem-resume");
    const row = await env.CORPUS_DB.prepare(
      "SELECT COUNT(*) AS n FROM corpus_generations WHERE id = ?",
    )
      .bind("idem-resume")
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});
