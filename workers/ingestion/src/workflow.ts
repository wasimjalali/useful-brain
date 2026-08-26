import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import { parseBoundedId } from "../../../src/lib/cf/bounded-id";
import { acknowledgeIngestJob } from "../../../src/lib/ingest/queue-message";

export type IngestionWorkflowParams = {
  jobId: string;
  idempotencyKey: string;
};

export class IngestionWorkflow extends WorkflowEntrypoint<Env, IngestionWorkflowParams> {
  async run(event: WorkflowEvent<IngestionWorkflowParams>, step: WorkflowStep) {
    const jobId = parseBoundedId(event.payload.jobId, "job id");
    const idempotencyKey = parseBoundedId(event.payload.idempotencyKey, "idempotency key");
    return step.do("accept-ingestion-job", async () => {
      return acknowledgeIngestJob({ jobId, idempotencyKey });
    });
  }
}
