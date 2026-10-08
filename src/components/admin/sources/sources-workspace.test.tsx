import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SourcesResponse, UploadRequest, UploadStatus } from "@/lib/contracts/sources";
import type { ActionResult } from "@/lib/rag/app-errors";

import { SourcesWorkspace, SOURCES_MAX_POLLS, SOURCES_POLL_MS, type SourcesActions } from "./sources-workspace";
import { UPLOAD_MAX_POLLS } from "./upload-flow";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const NOW = Date.UTC(2026, 8, 6);

function sources(over: Partial<SourcesResponse> = {}): SourcesResponse {
  return {
    active: { id: "g-c305cf57", promotedAt: NOW, documents: 62, chunks: 787, retrieval: "hybrid" },
    draft: null,
    documents: [
      { id: "d1", title: "Leave Policy", fileName: "leave-policy.md", department: "hr", readers: { kind: "everyone", names: [] }, chunks: 4, updatedAt: NOW, status: "active" },
      { id: "d2", title: "Expenses", fileName: "expenses.pdf", department: "finance", readers: { kind: "departments", names: ["finance"] }, chunks: 6, updatedAt: NOW, status: "active" },
    ],
    ...over,
  };
}

const building = (embeddedChunks = 10) =>
  sources({ draft: { id: "g-7d19a4e0", kind: "upload", state: "building", embeddedChunks, totalChunks: 58, documents: 2, failedFiles: 0 } });
const passed = () =>
  sources({
    draft: {
      id: "g-7d19a4e0",
      kind: "upload",
      state: "checks_passed",
      embeddedChunks: 58,
      totalChunks: 58,
      documents: 2,
      failedFiles: 0,
      checks: { reconciled: true, aclLeaks: 0, liveRecall: 0.995, errorCode: null },
    },
  });

const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
const fail = (message: string): ActionResult<never> => ({
  ok: false,
  error: { code: "INTERNAL_ERROR", message, retryable: true },
});

function actions(over: Partial<SourcesActions> = {}): SourcesActions {
  return {
    loadSources: vi.fn(async () => ok(sources())),
    reindex: vi.fn(async () => ok({ ok: true as const, generationId: "g-new" })),
    promoteDraft: vi.fn(async (id: string) => ok({ ok: true as const, generationId: id })),
    discardDraft: vi.fn(async (id: string) => ok({ ok: true as const, generationId: id })),
    createUpload: vi.fn(async (request: UploadRequest) =>
      ok({ batchId: "b1", files: request.files.map((file, index) => ({ id: `f${index}`, name: file.name })) }),
    ),
    uploadStatus: vi.fn(async () => ok<UploadStatus>({ batchId: "b1", files: [] })),
    putFile: vi.fn(async () => ({ ok: true as const })),
    ...over,
  };
}

function mount(initial: SourcesResponse, a: SourcesActions, extra: { initialUploadOpen?: boolean } = {}) {
  return render(<SourcesWorkspace actions={a} initial={initial} peopleTotal={148} {...extra} />);
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SourcesWorkspace rendering", () => {
  it("shows the subtitle, counts and rows from the server data", () => {
    mount(sources(), actions());
    expect(screen.getByRole("heading", { name: "Sources" })).toBeInTheDocument();
    expect(screen.getByText("2 documents · readers only see the active generation")).toBeInTheDocument();
    expect(screen.getByText("Leave Policy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Active\s*2/ })).toBeInTheDocument();
  });

  it("filters by search and by status chip", () => {
    mount(sources(), actions());
    fireEvent.change(screen.getByRole("searchbox", { name: "Search documents and file names" }), { target: { value: "expenses.pdf" } });
    expect(screen.queryByText("Leave Policy")).not.toBeInTheDocument();
    expect(screen.getByText("Expenses")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Draft\s*0/ }));
    expect(screen.queryByText("Expenses")).not.toBeInTheDocument();
  });

  it("starts a re-index and shows the failure from Brain when one is already open", async () => {
    const a = actions({ reindex: vi.fn(async () => fail("A draft is already open. Promote or discard it first.")) });
    mount(sources(), a);
    fireEvent.click(screen.getByRole("button", { name: "Re-index" }));
    await tick(0);
    expect(a.reindex).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("A draft is already open. Promote or discard it first.");
  });

  it("refreshes the page data after a re-index starts", async () => {
    const a = actions({ loadSources: vi.fn(async () => ok(building(0))) });
    mount(sources(), a);
    fireEvent.click(screen.getByRole("button", { name: "Re-index" }));
    await tick(0);
    expect(a.loadSources).toHaveBeenCalledOnce();
    expect(screen.getByText("Embedding 0 of 58 chunks · 2 documents · 0 failed")).toBeInTheDocument();
  });
});

describe("SourcesWorkspace polling", () => {
  it("does not poll when there is no draft or the checks are done", async () => {
    const a = actions();
    const first = mount(sources(), a);
    await tick(SOURCES_POLL_MS * 5);
    first.unmount();
    mount(passed(), a);
    await tick(SOURCES_POLL_MS * 5);
    expect(a.loadSources).not.toHaveBeenCalled();
  });

  it("polls every 2s while a draft builds and stops once checks pass", async () => {
    const loadSources = vi.fn<SourcesActions["loadSources"]>()
      .mockResolvedValueOnce(ok(building(30)))
      .mockResolvedValueOnce(ok(passed()))
      .mockResolvedValue(ok(passed()));
    mount(building(), actions({ loadSources }));
    await tick(SOURCES_POLL_MS - 1);
    expect(loadSources).not.toHaveBeenCalled();
    await tick(1);
    expect(loadSources).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Embedding 30 of 58 chunks · 2 documents · 0 failed")).toBeInTheDocument();
    await tick(SOURCES_POLL_MS);
    expect(loadSources).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Checks passed")).toBeInTheDocument();
    await tick(SOURCES_POLL_MS * 5);
    expect(loadSources).toHaveBeenCalledTimes(2);
  });

  it("keeps one request in flight however slow the server is", async () => {
    let release: (value: ActionResult<SourcesResponse>) => void = () => undefined;
    const loadSources = vi.fn(
      () => new Promise<ActionResult<SourcesResponse>>((resolve) => { release = resolve; }),
    );
    mount(building(), actions({ loadSources }));
    await tick(SOURCES_POLL_MS * 6);
    expect(loadSources).toHaveBeenCalledTimes(1);
    await act(async () => release(ok(building(40))));
    await tick(SOURCES_POLL_MS);
    expect(loadSources).toHaveBeenCalledTimes(2);
  });

  it("stops polling on unmount", async () => {
    const a = actions({ loadSources: vi.fn(async () => ok(building())) });
    const view = mount(building(), a);
    await tick(SOURCES_POLL_MS);
    expect(a.loadSources).toHaveBeenCalledTimes(1);
    view.unmount();
    await tick(SOURCES_POLL_MS * 5);
    expect(a.loadSources).toHaveBeenCalledTimes(1);
  });

  it("stops after the poll bound", async () => {
    const a = actions({ loadSources: vi.fn(async () => ok(building())) });
    mount(building(), a);
    await tick(SOURCES_POLL_MS * (SOURCES_MAX_POLLS + 20));
    expect(a.loadSources).toHaveBeenCalledTimes(SOURCES_MAX_POLLS);
  });

  it("stops and shows a retry when a poll fails", async () => {
    const loadSources = vi.fn<SourcesActions["loadSources"]>()
      .mockResolvedValueOnce(fail("The corpus database didn't respond."))
      .mockResolvedValue(ok(building(50)));
    mount(building(), actions({ loadSources }));
    await tick(SOURCES_POLL_MS * 3);
    expect(loadSources).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("The corpus database didn't respond.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await tick(SOURCES_POLL_MS);
    expect(loadSources).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SourcesWorkspace promote and discard", () => {
  it("asks before promoting and does nothing on Cancel", async () => {
    const a = actions();
    mount(passed(), a);
    fireEvent.click(screen.getByRole("button", { name: "Promote draft" }));
    const dialog = screen.getByRole("dialog", { name: "Promote draft" });
    expect(a.promoteDraft).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await tick(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(a.promoteDraft).not.toHaveBeenCalled();
  });

  it("promotes the draft after confirming, then reloads the sources", async () => {
    const a = actions({ loadSources: vi.fn(async () => ok(sources())) });
    mount(passed(), a);
    fireEvent.click(screen.getByRole("button", { name: "Promote draft" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Promote draft" })).getByRole("button", { name: "Promote" }));
    await tick(0);
    expect(a.promoteDraft).toHaveBeenCalledWith("g-7d19a4e0");
    expect(a.loadSources).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Checks passed")).not.toBeInTheDocument();
  });

  it("keeps the draft and shows Brain's message when promote is refused", async () => {
    const a = actions({ promoteDraft: vi.fn(async () => fail("This draft hasn't passed its checks.")) });
    mount(passed(), a);
    fireEvent.click(screen.getByRole("button", { name: "Promote draft" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Promote draft" })).getByRole("button", { name: "Promote" }));
    await tick(0);
    expect(screen.getByRole("alert")).toHaveTextContent("This draft hasn't passed its checks.");
    expect(screen.getByText("Checks passed")).toBeInTheDocument();
  });

  it("asks before discarding and discards only after confirming", async () => {
    const a = actions();
    mount(passed(), a);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    const dialog = screen.getByRole("dialog", { name: "Discard draft" });
    expect(a.discardDraft).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    await tick(0);
    expect(a.discardDraft).toHaveBeenCalledWith("g-7d19a4e0");
  });

  it("does not send a second request while one is in flight", async () => {
    let release: () => void = () => undefined;
    const promoteDraft = vi.fn(
      () => new Promise<ActionResult<{ ok: true; generationId: string }>>((resolve) => {
        release = () => resolve(ok({ ok: true as const, generationId: "g-7d19a4e0" }));
      }),
    );
    mount(passed(), actions({ promoteDraft }));
    fireEvent.click(screen.getByRole("button", { name: "Promote draft" }));
    const confirm = within(screen.getByRole("dialog", { name: "Promote draft" })).getByRole("button", { name: "Promote" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await tick(0);
    expect(promoteDraft).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });
});

describe("SourcesWorkspace upload", () => {
  const md = (name: string, text = "# Title\n\nbody") => new File([text], name, { type: "text/markdown" });

  function addFiles(files: File[]) {
    const input = screen.getByLabelText("Choose files") as HTMLInputElement;
    fireEvent.change(input, { target: { files } });
  }

  it("opens the dialog from the header and when ?upload=1 asked for it", () => {
    const first = mount(sources(), actions());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Upload documents" }));
    expect(screen.getByRole("dialog", { name: "Upload documents" })).toBeInTheDocument();
    first.unmount();
    cleanup();
    mount(sources(), actions(), { initialUploadOpen: true });
    expect(screen.getByRole("dialog", { name: "Upload documents" })).toBeInTheDocument();
    expect(screen.getByText("All 148 people at Northwind.")).toBeInTheDocument();
  });

  it("creates the batch, then sends each file in order, then polls stages to Ready", async () => {
    const order: string[] = [];
    const a = actions({
      createUpload: vi.fn(async (request: UploadRequest) => {
        order.push("create");
        return ok({ batchId: "b1", files: request.files.map((file, index) => ({ id: `f${index}`, name: file.name })) });
      }),
      putFile: vi.fn(async (_batchId: string, fileId: string) => {
        order.push(`put:${fileId}`);
        return { ok: true as const };
      }),
    });
    let polls = 0;
    a.uploadStatus = vi.fn(async () => {
      order.push("status");
      polls += 1;
      const stage = polls === 1 ? "embedding" : "ready";
      return ok<UploadStatus>({ batchId: "b1", files: [{ id: "f0", name: "a.md", stage }, { id: "f1", name: "b.md", stage }] });
    });
    mount(sources(), a, { initialUploadOpen: true });
    addFiles([md("a.md"), md("b.md")]);
    await tick(0);
    expect(a.createUpload).toHaveBeenCalledOnce();
    const request = (a.createUpload as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.readers).toEqual({ kind: "everyone" });
    expect(request.files.map((file: { name: string }) => file.name)).toEqual(["a.md", "b.md"]);
    expect(request.files[0].size).toBe(md("a.md").size);
    expect(request.idempotencyKey).toMatch(/[0-9a-f-]{36}/);
    expect(order.slice(0, 3)).toEqual(["create", "put:f0", "put:f1"]);
    expect(screen.getByRole("button", { name: "Add to draft" })).toBeDisabled();
    await tick(1000);
    expect(screen.getAllByText("Embedding")).toHaveLength(2);
    await tick(1000);
    expect(screen.getByText("2 of 2 ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to draft" })).toBeEnabled();
    const callsWhenReady = (a.uploadStatus as ReturnType<typeof vi.fn>).mock.calls.length;
    await tick(5000);
    expect((a.uploadStatus as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsWhenReady);
  });

  it("keeps one status request in flight", async () => {
    let release: (value: ActionResult<UploadStatus>) => void = () => undefined;
    const uploadStatus = vi.fn(() => new Promise<ActionResult<UploadStatus>>((resolve) => { release = resolve; }));
    mount(sources(), actions({ uploadStatus }), { initialUploadOpen: true });
    addFiles([md("a.md")]);
    await tick(5000);
    expect(uploadStatus).toHaveBeenCalledTimes(1);
    await act(async () => release(ok({ batchId: "b1", files: [{ id: "f0", name: "a.md", stage: "ready" }] })));
    expect(screen.getByText("1 of 1 ready")).toBeInTheDocument();
  });

  it("closes on Add to draft and reloads the page data", async () => {
    const a = actions({
      uploadStatus: vi.fn(async () => ok<UploadStatus>({ batchId: "b1", files: [{ id: "f0", name: "a.md", stage: "ready" }] })),
      loadSources: vi.fn(async () => ok(building(0))),
    });
    mount(sources(), a, { initialUploadOpen: true });
    addFiles([md("a.md")]);
    await tick(1000);
    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));
    await tick(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(a.loadSources).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("Embedding 0 of 58 chunks · 2 documents · 0 failed")).toBeInTheDocument();
  });

  it("marks files failed with the server message when the batch cannot be created", async () => {
    const a = actions({ createUpload: vi.fn(async () => fail("A draft is being checked. Wait for it to finish.")) });
    mount(sources(), a, { initialUploadOpen: true });
    addFiles([md("a.md")]);
    await tick(0);
    expect(screen.getByText("A draft is being checked. Wait for it to finish.")).toBeInTheDocument();
    expect(a.putFile).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add to draft" })).toBeDisabled();
  });

  it("marks a file failed when its upload is refused and still sends the others", async () => {
    const putFile = vi.fn(async (_b: string, fileId: string) =>
      fileId === "f0" ? { ok: false as const, message: "The request is invalid." } : { ok: true as const },
    );
    const a = actions({ putFile, uploadStatus: vi.fn(async () => ok<UploadStatus>({ batchId: "b1", files: [{ id: "f1", name: "b.md", stage: "ready" }] })) });
    mount(sources(), a, { initialUploadOpen: true });
    addFiles([md("a.md"), md("b.md")]);
    await tick(1000);
    expect(putFile).toHaveBeenCalledTimes(2);
    expect(screen.getByText("The request is invalid.")).toBeInTheDocument();
  });

  it("rejects an unsupported file inline and never uploads it", async () => {
    const a = actions();
    mount(sources(), a, { initialUploadOpen: true });
    addFiles([new File(["x"], "photo.png")]);
    await tick(0);
    expect(screen.getByRole("alert")).toHaveTextContent("photo.png: unsupported file type");
    expect(a.createUpload).not.toHaveBeenCalled();
  });

  it("waits for a department before uploading, then sends the chosen readers", async () => {
    const a = actions();
    mount(sources(), a, { initialUploadOpen: true });
    fireEvent.click(screen.getByRole("radio", { name: "Departments" }));
    addFiles([md("a.md")]);
    await tick(0);
    expect(a.createUpload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "HR" }));
    await tick(0);
    expect(a.createUpload).toHaveBeenCalledOnce();
    expect((a.createUpload as ReturnType<typeof vi.fn>).mock.calls[0][0].readers).toEqual({ kind: "departments", names: ["hr"] });
  });

  it("stops polling when the dialog is cancelled", async () => {
    const a = actions({ uploadStatus: vi.fn(async () => ok<UploadStatus>({ batchId: "b1", files: [{ id: "f0", name: "a.md", stage: "embedding" }] })) });
    mount(sources(), a, { initialUploadOpen: true });
    addFiles([md("a.md")]);
    await tick(1000);
    const calls = (a.uploadStatus as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    await tick(5000);
    expect((a.uploadStatus as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("locks the readers once a file has started and shows them on the row", async () => {
    const a = actions();
    mount(sources(), a, { initialUploadOpen: true });
    addFiles([md("a.md")]);
    await tick(0);
    expect(screen.getByRole("radio", { name: "Departments" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Roles" })).toBeDisabled();
    expect(within(screen.getByRole("list", { name: "Files" })).getByText(/Everyone/)).toBeInTheDocument();
  });

  it("locks department chips after the first batch starts", async () => {
    mount(sources(), actions(), { initialUploadOpen: true });
    fireEvent.click(screen.getByRole("radio", { name: "Departments" }));
    fireEvent.click(screen.getByRole("button", { name: "HR" }));
    addFiles([md("a.md")]);
    await tick(0);
    expect(screen.getByRole("button", { name: "Legal" })).toBeDisabled();
    expect(within(screen.getByRole("list", { name: "Files" })).getByText(/HR/)).toBeInTheDocument();
  });

  it("keeps the readers locked and the file working when status polls fail", async () => {
    const uploadStatus = vi.fn(async () => fail("Couldn't read the upload status."));
    mount(sources(), actions({ uploadStatus }), { initialUploadOpen: true });
    addFiles([md("a.md")]);
    await tick(5000);
    expect(uploadStatus.mock.calls.length).toBeGreaterThanOrEqual(3);
    // The server may still be indexing the file with these readers.
    expect(screen.getByRole("radio", { name: "Departments" })).toBeDisabled();
    expect(screen.getByText("Status unavailable, check Sources")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't read the upload status.")).not.toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Files" })).queryByText("Failed")).not.toBeInTheDocument();
  });

  it("clears the status note once a poll succeeds again", async () => {
    let calls = 0;
    const uploadStatus = vi.fn(async () => {
      calls += 1;
      return calls <= 3
        ? fail("Couldn't read the upload status.")
        : ok<UploadStatus>({ batchId: "b1", files: [{ id: "f0", name: "a.md", stage: "embedding" }] });
    });
    mount(sources(), actions({ uploadStatus }), { initialUploadOpen: true });
    addFiles([md("a.md")]);
    await tick(3000);
    expect(screen.getByText("Status unavailable, check Sources")).toBeInTheDocument();
    await tick(1000);
    expect(screen.queryByText("Status unavailable, check Sources")).not.toBeInTheDocument();
    expect(screen.getByText("Embedding")).toBeInTheDocument();
  });

  it("keeps the readers locked when a refused transfer may still have reached the draft", async () => {
    const putFile = vi.fn(async () => ({ ok: false as const, message: "The file couldn't be uploaded. Check your connection." }));
    mount(sources(), actions({ putFile }), { initialUploadOpen: true });
    addFiles([md("a.md")]);
    await tick(1000);
    expect(screen.getByText("The file couldn't be uploaded. Check your connection.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Departments" })).toBeDisabled();
  });

  it("releases the readers once the server reports the only file failed", async () => {
    const uploadStatus = vi.fn(async () =>
      ok<UploadStatus>({ batchId: "b1", files: [{ id: "f0", name: "a.md", stage: "failed", errorMessage: "This file is empty." }] }),
    );
    mount(sources(), actions({ uploadStatus }), { initialUploadOpen: true });
    addFiles([md("a.md")]);
    await tick(1000);
    expect(screen.getByText("This file is empty.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Departments" })).toBeEnabled();
  });

  it("keeps sending the remaining files after the dialog is closed, then reloads", async () => {
    let releaseFirst: () => void = () => undefined;
    const putFile = vi.fn((_b: string, fileId: string) =>
      fileId === "f0"
        ? new Promise<{ ok: true }>((resolve) => { releaseFirst = () => resolve({ ok: true }); })
        : Promise.resolve({ ok: true as const }),
    );
    const a = actions({ putFile });
    mount(sources(), a, { initialUploadOpen: true });
    addFiles([md("a.md"), md("b.md")]);
    await tick(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    const loads = (a.loadSources as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => releaseFirst());
    await tick(0);
    expect(putFile).toHaveBeenCalledTimes(2);
    expect((a.loadSources as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(loads);
  });

  it("rejects an empty file, a repeated name (any case) and the 26th file inline", async () => {
    const a = actions();
    mount(sources(), a, { initialUploadOpen: true });
    addFiles([new File([], "empty.md"), md("Notes.md"), md("notes.MD")]);
    await tick(0);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("empty.md: the file is empty");
    expect(alert).toHaveTextContent("notes.MD: a file with this name is already in the list");
    expect((a.createUpload as ReturnType<typeof vi.fn>).mock.calls[0][0].files.map((f: { name: string }) => f.name)).toEqual(["Notes.md"]);
    cleanup();
    const b = actions();
    mount(sources(), b, { initialUploadOpen: true });
    addFiles(Array.from({ length: 26 }, (_, i) => md(`f${i}.md`)));
    await tick(0);
    expect(screen.getByRole("alert")).toHaveTextContent("f25.md: at most 25 files at a time");
    expect((b.createUpload as ReturnType<typeof vi.fn>).mock.calls[0][0].files).toHaveLength(25);
  });

  it("lets a failed row be removed so the rest can be added", async () => {
    const putFile = vi.fn(async (_b: string, fileId: string) =>
      fileId === "f0" ? { ok: false as const, message: "Upload refused." } : { ok: true as const },
    );
    const a = actions({
      putFile,
      uploadStatus: vi.fn(async () => ok<UploadStatus>({ batchId: "b1", files: [{ id: "f1", name: "b.md", stage: "ready" }] })),
    });
    mount(sources(), a, { initialUploadOpen: true });
    addFiles([md("a.md"), md("b.md")]);
    await tick(1000);
    expect(screen.getByRole("button", { name: "Add to draft" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove a.md" }));
    expect(screen.queryByText("a.md")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to draft" })).toBeEnabled();
  });

  it("stops polling a stuck file after a cap and says it is still processing", async () => {
    const uploadStatus = vi.fn(async () => ok<UploadStatus>({ batchId: "b1", files: [{ id: "f0", name: "a.md", stage: "embedding" }] }));
    mount(sources(), actions({ uploadStatus }), { initialUploadOpen: true });
    addFiles([md("a.md")]);
    await tick(UPLOAD_MAX_POLLS * 1000 + 5000);
    const calls = uploadStatus.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(UPLOAD_MAX_POLLS);
    expect(screen.getByText("Still processing, check Sources")).toBeInTheDocument();
    await tick(10_000);
    expect(uploadStatus.mock.calls.length).toBe(calls);
  });
});
