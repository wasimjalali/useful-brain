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
        body: { jobId: "q-job-1", idempotencyKey: "q-idem-1" },
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
  });

  it("acks a duplicate delivery of the same idempotency key", async () => {
    const first = createMessageBatch("useful-brain-ingest-development", [
      {
        id: "msg-dup-1",
        timestamp: new Date(),
        attempts: 1,
        body: { jobId: "q-job-dup", idempotencyKey: "q-idem-dup" },
      },
    ]);
    const second = createMessageBatch("useful-brain-ingest-development", [
      {
        id: "msg-dup-2",
        timestamp: new Date(),
        attempts: 2,
        body: { jobId: "q-job-dup", idempotencyKey: "q-idem-dup" },
      },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(first, env, ctx);
    await worker.queue(second, env, ctx);
    expect((await getQueueResult(first, ctx)).explicitAcks).toEqual(["msg-dup-1"]);
    expect((await getQueueResult(second, ctx)).explicitAcks).toEqual(["msg-dup-2"]);
  });

  it("retries a transient workflow create failure", async () => {
    const batch = createMessageBatch("useful-brain-ingest-development", [
      {
        id: "msg-retry",
        timestamp: new Date(),
        attempts: 1,
        body: { jobId: "q-job-retry", idempotencyKey: "q-idem-retry" },
      },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(
      batch,
      {
        ...env,
        INGESTION_WORKFLOW: {
          create: async () => {
            throw new Error("timeout contacting workflow engine");
          },
        },
      },
      ctx,
    );
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages).toHaveLength(1);
  });
});
