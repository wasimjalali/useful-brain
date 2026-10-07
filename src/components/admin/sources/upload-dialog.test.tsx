import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { UploadFileView } from "@/lib/contracts/admin-manage-view";

import { UploadDialog } from "./upload-dialog";

const files: UploadFileView[] = [
  { id: "1", name: "holiday-calendar-2027.pdf", sizeLabel: "412 KB", stage: "ready" },
  { id: "2", name: "home-office-stipend-policy.docx", sizeLabel: "88 KB", stage: "embedding" },
];

function setup(over: Partial<Parameters<typeof UploadDialog>[0]> = {}) {
  const base = {
    files,
    scope: "departments" as const,
    selectedGroups: ["HR"],
    peopleCount: 148,
    onScopeChange: vi.fn(),
    onToggleGroup: vi.fn(),
    onFilesAdded: vi.fn<(files: File[]) => void>(),
    onCancel: vi.fn(),
    onSubmit: vi.fn(),
    ...over,
  };
  render(<UploadDialog {...base} />);
  return base as typeof base & { onFilesAdded: ReturnType<typeof vi.fn<(files: File[]) => void>> };
}

function file(name: string, bytes: number) {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

describe("UploadDialog", () => {
  it("is a 560px dialog with the dropzone copy and layers note", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Upload documents" })).toHaveStyle({ width: "560px" });
    expect(screen.getByText("PDF, DOCX or Markdown, up to 25 MB each")).toBeInTheDocument();
    expect(screen.getByText("Files go into a draft. Nothing changes for readers until you promote it.")).toBeInTheDocument();
  });

  it("shows stage text, Ready in success colour semantic, and n of m ready", () => {
    setup();
    expect(screen.getByText("Embedding")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 ready")).toBeInTheDocument();
  });

  it("keeps Add to draft disabled until every file is ready", () => {
    const p = setup();
    const add = screen.getByRole("button", { name: "Add to draft" });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(p.onSubmit).not.toHaveBeenCalled();
  });

  it("enables Add to draft when all files are ready and fires submit", () => {
    const p = setup({ files: files.map((f) => ({ ...f, stage: "ready" as const })) });
    fireEvent.click(screen.getByRole("button", { name: "Add to draft" }));
    expect(p.onSubmit).toHaveBeenCalledOnce();
  });

  it("keeps it disabled with no files and with a failed file", () => {
    setup({ files: [] });
    expect(screen.getByRole("button", { name: "Add to draft" })).toBeDisabled();
  });

  it("a failed file blocks submit and shows its error", () => {
    setup({ files: [{ id: "9", name: "bad.pdf", sizeLabel: "1 MB", stage: "failed", error: "No text layer" }] });
    expect(screen.getByText("No text layer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to draft" })).toBeDisabled();
  });

  it("rejects unsupported and oversize files inline and passes only valid ones", () => {
    const p = setup();
    const input = screen.getByLabelText("Choose files") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [file("ok.md", 1000), file("notes.txt", 10), file("sheet.xlsx", 10), file("huge.pdf", 26 * 1024 * 1024)] },
    });
    expect(p.onFilesAdded).toHaveBeenCalledTimes(1);
    expect((p.onFilesAdded.mock.calls[0][0] as File[]).map((f) => f.name)).toEqual(["ok.md", "notes.txt"]);
    expect(screen.getByText("sheet.xlsx: unsupported file type")).toBeInTheDocument();
    expect(screen.getByText("huge.pdf: larger than 25 MB")).toBeInTheDocument();
  });

  it("accepts dropped files through the dropzone", () => {
    const p = setup();
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [file("a.docx", 5)] } });
    expect((p.onFilesAdded.mock.calls[0][0] as File[])[0].name).toBe("a.docx");
  });

  it("Everyone hides the chips and states the head count", () => {
    setup({ scope: "everyone", selectedGroups: [] });
    expect(screen.getByText("All 148 people at Northwind.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Engineering" })).not.toBeInTheDocument();
  });

  it("scope change and group toggles report through callbacks", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Roles" }));
    expect(p.onScopeChange).toHaveBeenCalledWith("roles");
    expect(screen.getByRole("button", { name: "HR" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Legal" }));
    expect(p.onToggleGroup).toHaveBeenCalledWith("Legal");
  });

  it("Roles scope lists the role chips", () => {
    setup({ scope: "roles", selectedGroups: [] });
    expect(screen.getByRole("button", { name: "HR managers" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Legal" })).not.toBeInTheDocument();
  });

  it("Escape and Cancel both cancel", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(p.onCancel).toHaveBeenCalledTimes(2);
  });
});
