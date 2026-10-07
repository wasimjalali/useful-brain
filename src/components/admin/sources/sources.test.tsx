import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  ActiveGenerationView,
  DraftGenerationView,
  SourceRowView,
} from "@/lib/contracts/admin-manage-view";

import { GenerationCard } from "./generation-card";
import { SourcesTable } from "./sources-table";
import { SourcesView } from "./sources-view";

const active: ActiveGenerationView = {
  id: "g-c305cf57",
  promotedLabel: "6 Sep 2026",
  documents: 62,
  chunks: 787,
  retrieval: "Hybrid",
};

function card(draft: DraftGenerationView | null, extra: Partial<Parameters<typeof GenerationCard>[0]> = {}) {
  const onPromote = vi.fn();
  const onDiscard = vi.fn();
  render(<GenerationCard active={active} draft={draft} onDiscard={onDiscard} onPromote={onPromote} {...extra} />);
  return { onPromote, onDiscard };
}

describe("GenerationCard", () => {
  it("shows the active generation facts and no draft row without a draft", () => {
    card(null);
    expect(screen.getByText("g-c305cf57")).toBeInTheDocument();
    expect(screen.getByText("787")).toBeInTheDocument();
    expect(screen.getByText("Hybrid")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("building: progress, percent and a disabled Promote draft", () => {
    card({ state: "building", id: "g-7d19a4e0", embeddedChunks: 41, totalChunks: 58, documents: 2, failed: 1 });
    expect(screen.getByText("Embedding 41 of 58 chunks · 2 documents · 1 failed")).toBeInTheDocument();
    expect(screen.getByText("71%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "71");
    expect(screen.getByRole("button", { name: "Promote draft" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
  });

  it("building with zero total chunks shows 0% and does not divide by zero", () => {
    card({ state: "building", id: "g-1", embeddedChunks: 0, totalChunks: 0, documents: 0, failed: 0 });
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("checks passed: Discard and Promote draft fire their callbacks", () => {
    const { onPromote, onDiscard } = card({ state: "checks_passed", id: "g-7d19a4e0", summary: "2 documents, 58 chunks · reconciled" });
    expect(screen.getByText("Checks passed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Promote draft" }));
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onPromote).toHaveBeenCalledOnce();
  });

  it("checks failed: promote is disabled, discard stays available", () => {
    card({ state: "checks_failed", id: "g-2", summary: "ACL leaks 1" });
    expect(screen.getByText("Checks failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Promote draft" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
  });

  it("paused: says checks are paused and blocks promotion", () => {
    card({ state: "paused", id: "g-3", summary: "Daily check limit reached" });
    expect(screen.getByText("Checks paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Promote draft" })).toBeDisabled();
  });

  it("disables both draft actions while a promote is in flight", () => {
    card({ state: "checks_passed", id: "g-4", summary: "ok" }, { busy: true });
    expect(screen.getByRole("button", { name: "Promote draft" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
  });
});

const rows: SourceRowView[] = [
  { id: "a", title: "Anti-Harassment Policy", fileName: "anti-harassment-policy.md", errorMessage: null, department: "HR", readers: "Everyone", chunks: 5, updatedLabel: "6 Sep 2026", status: "active" },
  { id: "b", title: "northwind-core-release-notes-2026-q3-addendum-final-v4-signed (1).pdf", fileName: "x.pdf", errorMessage: "Could not read page 14: scanned image with no text layer", department: "Engineering", readers: "Engineering", chunks: null, updatedLabel: "7 Oct 2026", status: "failed" },
  { id: "c", title: null, fileName: "salary-bands.pdf", errorMessage: null, department: "HR", readers: "Owner only", chunks: 9, updatedLabel: "1 Sep 2026", status: "active" },
  { id: "d", title: "Holiday Calendar 2027", fileName: "holiday-calendar-2027.pdf", errorMessage: null, department: "HR", readers: "Everyone", chunks: 6, updatedLabel: "7 Oct 2026", status: "draft" },
];

describe("SourcesTable", () => {
  it("renders title, mono file name, status pills and the em-dash for missing chunks", () => {
    render(<SourcesTable rows={rows} />);
    const row = screen.getByText("Anti-Harassment Policy").closest("[role=row]") as HTMLElement;
    expect(within(row).getByText("anti-harassment-policy.md")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("failed rows show the error line instead of the file name, with a full tooltip on long titles", () => {
    render(<SourcesTable rows={rows} />);
    expect(screen.getByText("Could not read page 14: scanned image with no text layer")).toBeInTheDocument();
    expect(screen.queryByText("x.pdf")).not.toBeInTheDocument();
    const long = "northwind-core-release-notes-2026-q3-addendum-final-v4-signed (1).pdf";
    expect(screen.getByText(long)).toHaveAttribute("title", long);
  });

  it("private documents show Private document and never leak the title or file name", () => {
    render(<SourcesTable rows={rows} />);
    expect(screen.getByText("Private document")).toBeInTheDocument();
    expect(screen.queryByText("salary-bands.pdf")).not.toBeInTheDocument();
  });
});

describe("SourcesView", () => {
  function view(over: Partial<Parameters<typeof SourcesView>[0]> = {}) {
    const props = {
      active,
      draft: null,
      rows,
      counts: { all: 65, active: 62, draft: 2, failed: 1 },
      filter: "all" as const,
      query: "",
      documentCount: 65,
      onFilterChange: vi.fn(),
      onQueryChange: vi.fn(),
      onReindex: vi.fn(),
      onUpload: vi.fn(),
      onPromote: vi.fn(),
      onDiscard: vi.fn(),
      ...over,
    };
    render(<SourcesView {...props} />);
    return props;
  }

  it("header copy and actions", () => {
    const p = view();
    expect(screen.getByRole("heading", { name: "Sources" })).toBeInTheDocument();
    expect(screen.getByText("65 documents · readers only see the active generation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-index" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload documents" }));
    expect(p.onReindex).toHaveBeenCalledOnce();
    expect(p.onUpload).toHaveBeenCalledOnce();
  });

  it("status chips show counts and report the chosen filter", () => {
    const p = view();
    expect(screen.getByRole("button", { name: /^All\s*65$/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /^Failed\s*1$/ }));
    expect(p.onFilterChange).toHaveBeenCalledWith("failed");
  });

  it("search reports the query", () => {
    const p = view();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search documents and file names" }), { target: { value: "leave" } });
    expect(p.onQueryChange).toHaveBeenCalledWith("leave");
  });
});
