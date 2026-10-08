"use server";

import { brainJson } from "@/lib/cf/brain-client";
import type { ApprovalBinding } from "@/lib/agent/policy";
import type { ConversationView, FeedbackValue, Suggestion, SuggestionsResponse } from "@/lib/contracts/chat";
import type { DocumentResponse } from "@/lib/contracts/library";
import {
  actionFailure,
  actionSuccess,
  AppError,
  type ActionResult,
} from "@/lib/rag/app-errors";

const MAX_ID = 200;

function invalid(): ActionResult<never> {
  return actionFailure(new AppError("VALIDATION_FAILED", "That request is not valid.", false));
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID;
}

export async function loadSuggestionsAction(): Promise<ActionResult<Suggestion[]>> {
  try {
    const { suggestions } = await brainJson<SuggestionsResponse>("/suggestions");
    return actionSuccess(suggestions);
  } catch (error) {
    return actionFailure(error, {
      code: "INTERNAL_ERROR",
      message: "Suggestions could not be loaded.",
      retryable: true,
    });
  }
}

/** `null` clears the person's feedback on the message. */
export async function setFeedbackAction(
  messageId: string,
  value: FeedbackValue | null,
): Promise<ActionResult<null>> {
  if (!validId(messageId) || (value !== null && value !== "up" && value !== "down")) {
    return invalid();
  }
  try {
    const path = `/messages/${encodeURIComponent(messageId)}/feedback`;
    await brainJson(path, value === null ? { method: "DELETE" } : { method: "POST", json: { value } });
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error, {
      code: "INTERNAL_ERROR",
      message: "Your feedback could not be saved.",
      retryable: true,
    });
  }
}

export async function requestDocumentAction(messageId: string): Promise<ActionResult<null>> {
  if (!validId(messageId)) {
    return invalid();
  }
  try {
    await brainJson(`/messages/${encodeURIComponent(messageId)}/request-document`, {
      method: "POST",
      json: {},
    });
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error, {
      code: "INTERNAL_ERROR",
      message: "The request could not be sent.",
      retryable: true,
    });
  }
}

/** Reads a document the asker may read. With `messageId`, the spans the answer relied on come back too. */
export async function loadDocumentAction(input: {
  documentId: string;
  messageId?: string;
  citation?: string;
}): Promise<ActionResult<DocumentResponse>> {
  if (!validId(input.documentId) || (input.messageId !== undefined && !validId(input.messageId))) {
    return invalid();
  }
  const query = new URLSearchParams();
  if (input.messageId) {
    query.set("message", input.messageId);
    if (input.citation) {
      query.set("citation", input.citation);
    }
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  try {
    return actionSuccess(
      await brainJson<DocumentResponse>(`/documents/${encodeURIComponent(input.documentId)}${suffix}`),
    );
  } catch (error) {
    return actionFailure(error, {
      code: "INTERNAL_ERROR",
      message: "The document could not be loaded.",
      retryable: true,
    });
  }
}

/** The conversation with its stored extras (feedback, latency, approval). */
export async function loadConversationViewAction(
  conversationId: string,
): Promise<ActionResult<ConversationView>> {
  if (!validId(conversationId)) {
    return invalid();
  }
  try {
    return actionSuccess(
      await brainJson<ConversationView>(`/conversations/${encodeURIComponent(conversationId)}`),
    );
  } catch (error) {
    return actionFailure(error, {
      code: "INTERNAL_ERROR",
      message: "The conversation could not be loaded.",
      retryable: true,
    });
  }
}

/** Brain recomputes the binding from the run; the client supplies the run id only. */
export async function startApprovalAction(
  runId: string,
): Promise<ActionResult<{ workflowId: string; binding: ApprovalBinding }>> {
  if (!validId(runId)) {
    return invalid();
  }
  try {
    const started = await brainJson<{ workflowId: string; binding: ApprovalBinding }>("/approvals/start", {
      method: "POST",
      json: { runId },
    });
    return actionSuccess({ workflowId: started.workflowId, binding: started.binding });
  } catch (error) {
    return actionFailure(error, {
      code: "INTERNAL_ERROR",
      message: "The approval could not be started.",
      retryable: true,
    });
  }
}

export async function decideApprovalAction(input: {
  workflowId: string;
  decision: "approve" | "reject";
  binding: ApprovalBinding;
}): Promise<ActionResult<null>> {
  if (!validId(input.workflowId)) {
    return invalid();
  }
  if (input.decision !== "approve" && input.decision !== "reject") {
    return invalid();
  }
  try {
    await brainJson("/approvals/event", {
      method: "POST",
      json: { workflowId: input.workflowId, decision: input.decision, binding: input.binding },
    });
    return actionSuccess(null);
  } catch (error) {
    return actionFailure(error, {
      code: "INTERNAL_ERROR",
      message: "The decision could not be recorded.",
      retryable: true,
    });
  }
}
