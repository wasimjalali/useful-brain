import { BoundedIdError, parseBoundedId } from "../cf/bounded-id";

export class IngestQueueMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestQueueMessageError";
  }
}

export type IngestQueueMessage = {
  jobId: string;
  idempotencyKey: string;
};

export function parseIngestQueueMessage(body: unknown): IngestQueueMessage {
  if (!body || typeof body !== "object") {
    throw new IngestQueueMessageError("ingest queue message must be an object");
  }
  const record = body as Record<string, unknown>;
  try {
    return {
      jobId: parseBoundedId(record.jobId, "job id"),
      idempotencyKey: parseBoundedId(record.idempotencyKey, "idempotency key"),
    };
  } catch (error) {
    if (error instanceof BoundedIdError) {
      throw new IngestQueueMessageError(error.message);
    }
    throw error;
  }
}

export function acknowledgeIngestJob(message: IngestQueueMessage): {
  jobId: string;
  idempotencyKey: string;
  accepted: true;
} {
  return { ...message, accepted: true };
}
