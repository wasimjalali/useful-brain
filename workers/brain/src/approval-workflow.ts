import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { parseBoundedId } from "../../../src/lib/cf/bounded-id";
import { approvalsMatch, type ApprovalBinding } from "../../../src/lib/agent/policy";

export type ApprovalWorkflowParams = {
  binding: ApprovalBinding;
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
) {
  const binding = payload.binding;
  parseBoundedId(binding.idempotencyKey, "idempotency key");
  const event = await step.waitForEvent<ApprovalEvent>("wait-for-approval", {
    type: "approval",
    timeout: "15 minutes",
  });
  const body = eventPayload(event);
  return step.do("recheck-policy", async () => {
    if (body.decision !== "approve") {
      return { resume: false as const, reason: "rejected" };
    }
    if (!approvalsMatch(binding, body.binding, Date.now())) {
      return { resume: false as const, reason: "approval does not match stored binding" };
    }
    return { resume: true as const, idempotencyKey: binding.idempotencyKey };
  });
}

export class ApprovalWorkflow extends WorkflowEntrypoint<Env, ApprovalWorkflowParams> {
  async run(event: WorkflowEvent<ApprovalWorkflowParams>, step: WorkflowStep) {
    return runApprovalWorkflow(event.payload, step);
  }
}
