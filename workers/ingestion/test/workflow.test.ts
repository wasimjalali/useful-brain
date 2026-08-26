import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("IngestionWorkflow", () => {
  it("starts and executes a bounded idempotent step", async () => {
    await using instance = await introspectWorkflowInstance(env.INGESTION_WORKFLOW, "job-1");
    await env.INGESTION_WORKFLOW.create({
      id: "job-1",
      params: { jobId: "job-1", idempotencyKey: "idem-1" },
    });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toEqual({
      jobId: "job-1",
      idempotencyKey: "idem-1",
      accepted: true,
    });
    const step = await instance.waitForStepResult({ name: "accept-ingestion-job" });
    expect(step).toEqual({
      jobId: "job-1",
      idempotencyKey: "idem-1",
      accepted: true,
    });
  });
});
