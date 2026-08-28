import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { parseBoundedId, parseMutatingIdempotencyKey } from "../../../src/lib/cf/bounded-id";
import type { ApprovalBinding } from "../../../src/lib/agent/policy";
import { decideApproval, expireApproval } from "../../../src/lib/store/agent-runs";
import type { OperationsDatabase } from "../../../src/lib/store/conversations";
import type { ApprovalResumeMessage } from "./approval-resume";

export type ApprovalWorkflowParams = {
  runId: string;
  binding: ApprovalBinding;
};

type ApprovalWorkflowEnv = {
  OPERATIONS_DB: OperationsDatabase;
  APPROVAL_RESUME_QUEUE: Queue<ApprovalResumeMessage>;
};

export type ApprovalEvent = {
  decision: "approve" | "reject";
  binding: ApprovalBinding;
};

export async function runApprovalWorkflow(
  payload: ApprovalWorkflowParams,
  step: Pick<WorkflowStep, "waitForEvent" | "do">,
  env: ApprovalWorkflowEnv,
) {
  const runId = parseBoundedId(payload.runId, "run id");
  const binding = payload.binding;
  parseMutatingIdempotencyKey(binding.idempotencyKey);
  let body: ApprovalEvent;
  try {
    const event = await step.waitForEvent<ApprovalEvent>("wait-for-approval", {
      type: "approval",
      timeout: "15 minutes",
    });
    body = event.payload;
  } catch {
    return step.do("expire-approval", async () => {
      return expireApproval(env.OPERATIONS_DB, {
        runId,
        storedBinding: binding,
        now: Math.max(Date.now(), binding.expiresAt),
      });
    });
  }
  const decision = await step.do("persist-decision", async () => {
    return decideApproval(env.OPERATIONS_DB, {
      runId,
      storedBinding: binding,
      eventBinding: body.binding,
      decision: body.decision,
      now: Date.now(),
    });
  });
  if (!decision.resume) {
    return decision;
  }
  await step.do("enqueue-resume", async () => {
    await env.APPROVAL_RESUME_QUEUE.send({
      runId,
      idempotencyKey: decision.idempotencyKey,
    });
  });
  return { ...decision, runId };
}

export class ApprovalWorkflow extends WorkflowEntrypoint<ApprovalWorkflowEnv, ApprovalWorkflowParams> {
  async run(event: WorkflowEvent<ApprovalWorkflowParams>, step: WorkflowStep) {
    return runApprovalWorkflow(event.payload, step, this.env);
  }
}
