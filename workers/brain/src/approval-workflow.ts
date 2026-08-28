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

function eventPayload(event: { payload: ApprovalEvent } | ApprovalEvent): ApprovalEvent {
  if ("payload" in event && event.payload && "decision" in event.payload) {
    return event.payload;
  }
  return event as ApprovalEvent;
}

export async function runApprovalWorkflow(
  payload: ApprovalWorkflowParams,
  step: Pick<WorkflowStep, "waitForEvent" | "do">,
  env: ApprovalWorkflowEnv,
) {
  const runId = parseBoundedId(payload.runId, "run id");
  const binding = payload.binding;
  parseMutatingIdempotencyKey(binding.idempotencyKey);
  let event: Awaited<ReturnType<WorkflowStep["waitForEvent"]>>;
  try {
    event = await step.waitForEvent<ApprovalEvent>("wait-for-approval", {
      type: "approval",
      timeout: "15 minutes",
    });
  } catch {
    return step.do("expire-approval", async () => {
      return expireApproval(env.OPERATIONS_DB, {
        runId,
        storedBinding: binding,
        now: Math.max(Date.now(), binding.expiresAt),
      });
    });
  }
  const body = eventPayload(event);
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
