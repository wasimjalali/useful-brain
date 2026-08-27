import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import { parseBoundedId } from "../../../src/lib/cf/bounded-id";
import { acknowledgeIngestJob } from "../../../src/lib/ingest/queue-message";
import { ensureDraftGeneration, reconcileAndFinalize } from "../../../src/lib/store/corpus-d1";

export type IngestionWorkflowParams = {
  jobId: string;
  idempotencyKey: string;
};

export class IngestionWorkflow extends WorkflowEntrypoint<Env, IngestionWorkflowParams> {
  async run(event: WorkflowEvent<IngestionWorkflowParams>, step: WorkflowStep) {
    const jobId = parseBoundedId(event.payload.jobId, "job id");
    const idempotencyKey = parseBoundedId(event.payload.idempotencyKey, "idempotency key");
    const accepted = await step.do("accept-ingestion-job", async () => {
      return acknowledgeIngestJob({ jobId, idempotencyKey });
    });
    const generation = await step.do("ensure-draft-generation", async () => {
      return ensureDraftGeneration(this.env.CORPUS_DB, idempotencyKey);
    });
    const finalized = await step.do("reconcile-and-finalize", async () => {
      return reconcileAndFinalize(this.env.CORPUS_DB, generation.generationId);
    });
    return {
      ...accepted,
      generationId: finalized.generationId,
      state: finalized.state,
      auditStatus: finalized.auditStatus,
    };
  }
}
