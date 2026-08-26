import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import worker from "../src";

describe("ingestion queue consumer", () => {
  it("acks a bounded identifier-only message", async () => {
    const batch = createMessageBatch("useful-brain-ingest-development", [
      {
        id: "msg-1",
        timestamp: new Date(),
        attempts: 1,
        body: { jobId: "job-1", idempotencyKey: "idem-1" },
      },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env, ctx);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toEqual(["msg-1"]);
    expect(result.retryMessages).toEqual([]);
    expect(result.retryBatch.retry).toBe(false);
  });

  it("acks an invalid payload instead of retrying forever", async () => {
    const batch = createMessageBatch("useful-brain-ingest-development", [
      {
        id: "msg-bad",
        timestamp: new Date(),
        attempts: 1,
        body: { document: "# private source" },
      },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env, ctx);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toEqual(["msg-bad"]);
    expect(result.retryMessages).toEqual([]);
  });
});
