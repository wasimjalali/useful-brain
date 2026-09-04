import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KnowledgeWorkspace } from "./knowledge-workspace";

function fileWithPath(name: string, relativePath: string, content = "## Body\nText."): File {
  const file = new File([content], name, { type: "text/plain" });
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

const embeddingStorageStatus = {
  storedDocuments: 0,
  storedChunks: 0,
  embeddedChunks: 0,
  lastRunStatus: "not_started",
  lastRunMessage: null,
  lastEmbeddedAt: null,
  activeVersionId: null,
  readyVersionId: null,
  corpusStatus: "ready",
} as const;

async function openUploadDialog(addDocumentAction: (formData: FormData) => Promise<void>) {
  render(
    <KnowledgeWorkspace
      addDocumentAction={addDocumentAction}
      chunks={[]}
      documents={[]}
      embedAction={async () => {}}
      embeddingStorageStatus={embeddingStorageStatus}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Upload document" }));
  const input = document.querySelector('input[webkitdirectory]');
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

function setFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

describe("folder upload queue", () => {
  it("uploads every supported file and skips unsupported ones", async () => {
    const addDocumentAction = vi.fn<(formData: FormData) => Promise<void>>(async () => {});
    const input = await openUploadDialog(addDocumentAction);

    setFiles(input, [
      fileWithPath("refund.md", "policies/refund.md"),
      fileWithPath("warranty.txt", "policies/warranty.txt"),
      fileWithPath("logo.png", "policies/logo.png"),
    ]);

    await waitFor(() => {
      expect(addDocumentAction).toHaveBeenCalledTimes(2);
    });

    for (const call of addDocumentAction.mock.calls) {
      const formData = call[0] as FormData;
      const file = formData.get("file") as File;
      expect(["refund.md", "warranty.txt"]).toContain(file.name);
      expect(String(formData.get("title"))).toMatch(/^(refund|warranty)$/);
    }

    expect(await screen.findByText("Finished: 2 added, 1 not uploaded")).toBeInTheDocument();
    expect(screen.getByText("Skipped: unsupported file type")).toBeInTheDocument();
  });

  it("derives distinct titles from subfolder paths", async () => {
    const addDocumentAction = vi.fn<(formData: FormData) => Promise<void>>(async () => {});
    const input = await openUploadDialog(addDocumentAction);

    setFiles(input, [
      fileWithPath("index.md", "policies/2026/index.md"),
      fileWithPath("index.md", "policies/2025/index.md"),
    ]);

    await waitFor(() => {
      expect(addDocumentAction).toHaveBeenCalledTimes(2);
    });
    const titles = addDocumentAction.mock.calls.map(
      (call) => String((call[0] as unknown as FormData).get("title")),
    );
    expect(titles).toEqual(["2026 / index", "2025 / index"]);
  });

  it("shows a single error instead of a queue when the folder has no supported files", async () => {
    const addDocumentAction = vi.fn<(formData: FormData) => Promise<void>>(async () => {});
    const input = await openUploadDialog(addDocumentAction);

    setFiles(input, [fileWithPath("logo.png", "policies/logo.png")]);

    expect(await screen.findByText(/No supported files in that folder/)).toBeInTheDocument();
    expect(addDocumentAction).not.toHaveBeenCalled();
  });

  it("marks per-file failures without aborting the rest of the queue", async () => {
    const addDocumentAction = vi.fn<(formData: FormData) => Promise<void>>(
      async (formData: FormData) => {
        const file = formData.get("file") as File;
        if (file.name === "bad.md") {
          throw new Error("That document is larger than one knowledge document can hold");
        }
      },
    );
    const input = await openUploadDialog(addDocumentAction);

    setFiles(input, [
      fileWithPath("bad.md", "policies/bad.md"),
      fileWithPath("good.md", "policies/good.md"),
    ]);

    await waitFor(() => {
      expect(addDocumentAction).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Finished: 1 added, 1 not uploaded")).toBeInTheDocument();
    expect(screen.getByText(/larger than one knowledge document/)).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
  });
});
