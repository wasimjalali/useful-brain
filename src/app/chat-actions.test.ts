import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/rag/app-errors";

const brainJson = vi.fn();
vi.mock("@/lib/cf/brain-client", () => ({
  brainJson: (...args: unknown[]) => brainJson(...args),
}));

import {
  decideApprovalAction,
  loadConversationViewAction,
  loadDocumentAction,
  loadSuggestionsAction,
  requestDocumentAction,
  setFeedbackAction,
  startApprovalAction,
} from "./chat-actions";

beforeEach(() => {
  brainJson.mockReset();
});

describe("chat actions fail closed", () => {
  it("returns the error instead of throwing when Brain rejects", async () => {
    brainJson.mockRejectedValue(new AppError("NOT_FOUND", "missing", false));
    const result = await loadDocumentAction({ documentId: "nw_x" });
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("refuses an empty id before calling Brain", async () => {
    expect(await setFeedbackAction("", "up")).toMatchObject({ ok: false });
    expect(await requestDocumentAction("")).toMatchObject({ ok: false });
    expect(await loadDocumentAction({ documentId: "" })).toMatchObject({ ok: false });
    expect(await startApprovalAction("")).toMatchObject({ ok: false });
    expect(await loadConversationViewAction("")).toMatchObject({ ok: false });
    expect(
      await decideApprovalAction({ workflowId: "", decision: "approve", binding: {} as never }),
    ).toMatchObject({ ok: false });
    expect(brainJson).not.toHaveBeenCalled();
  });

  it("rejects a decision other than approve or reject", async () => {
    const result = await decideApprovalAction({
      workflowId: "w1",
      decision: "maybe" as never,
      binding: {} as never,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(brainJson).not.toHaveBeenCalled();
  });

  it("reports suggestions as empty-with-error, never as made-up data", async () => {
    brainJson.mockRejectedValue(new Error("boom"));
    expect(await loadSuggestionsAction()).toMatchObject({ ok: false });
  });
});

describe("chat actions call the Brain routes", () => {
  it("sets and clears feedback", async () => {
    brainJson.mockResolvedValue({});
    await setFeedbackAction("m1", "down");
    expect(brainJson).toHaveBeenLastCalledWith("/messages/m1/feedback", {
      method: "POST",
      json: { value: "down" },
    });
    await setFeedbackAction("m1", null);
    expect(brainJson).toHaveBeenLastCalledWith("/messages/m1/feedback", { method: "DELETE" });
  });

  it("requests a document for a message", async () => {
    brainJson.mockResolvedValue({ requested: true });
    await requestDocumentAction("m2");
    expect(brainJson).toHaveBeenCalledWith("/messages/m2/request-document", { method: "POST", json: {} });
  });

  it("loads a document with the message and citation that scope its spans", async () => {
    brainJson.mockResolvedValue({ id: "nw_x" });
    await loadDocumentAction({ documentId: "nw_x", messageId: "m3", citation: "[2]" });
    expect(brainJson).toHaveBeenCalledWith("/documents/nw_x?message=m3&citation=%5B2%5D");
    await loadDocumentAction({ documentId: "nw_x" });
    expect(brainJson).toHaveBeenLastCalledWith("/documents/nw_x");
  });

  it("starts an approval by run id only and decides with the binding Brain returned", async () => {
    brainJson.mockResolvedValueOnce({ pendingApproval: true, workflowId: "wf1", binding: { tool: "create_ticket" } });
    const started = await startApprovalAction("run1");
    expect(brainJson).toHaveBeenLastCalledWith("/approvals/start", { method: "POST", json: { runId: "run1" } });
    expect(started).toEqual({ ok: true, data: { workflowId: "wf1", binding: { tool: "create_ticket" } } });

    brainJson.mockResolvedValueOnce({ ok: true });
    await decideApprovalAction({ workflowId: "wf1", decision: "reject", binding: { tool: "create_ticket" } as never });
    expect(brainJson).toHaveBeenLastCalledWith("/approvals/event", {
      method: "POST",
      json: { workflowId: "wf1", decision: "reject", binding: { tool: "create_ticket" } },
    });
  });
});
