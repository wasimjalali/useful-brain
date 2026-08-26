import { describe, expect, it } from "vitest";

import { IngestQueueMessageError, acknowledgeIngestJob, parseIngestQueueMessage } from "./queue-message";

describe("ingest queue messages", () => {
  it("accepts a bounded identifier-only payload", () => {
    expect(parseIngestQueueMessage({ jobId: "job-1", idempotencyKey: "idem-1" })).toEqual({
      jobId: "job-1",
      idempotencyKey: "idem-1",
    });
  });

  it("rejects source text and unbounded identifiers", () => {
    expect(() => parseIngestQueueMessage({ jobId: "job-1", body: "# secret" })).toThrow(
      IngestQueueMessageError,
    );
    expect(() => parseIngestQueueMessage({ jobId: "../etc", idempotencyKey: "idem-1" })).toThrow(
      IngestQueueMessageError,
    );
  });

  it("acknowledges the same job idempotently", () => {
    const message = parseIngestQueueMessage({ jobId: "job-1", idempotencyKey: "idem-1" });
    expect(acknowledgeIngestJob(message)).toEqual({
      jobId: "job-1",
      idempotencyKey: "idem-1",
      accepted: true,
    });
    expect(acknowledgeIngestJob(message)).toEqual(acknowledgeIngestJob(message));
  });
});
