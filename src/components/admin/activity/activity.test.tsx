import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ActivityRowView } from "@/lib/contracts/admin-insights-view";

import { ActivityEmpty } from "./activity-empty";
import { ActivityError } from "./activity-error";
import { ActivityFilters } from "./activity-filters";
import { ActivityTable } from "./activity-table";

const row = (id: string, outcome: ActivityRowView["outcome"], sources: number | null = 1): ActivityRowView => ({
  id,
  time: "09:42",
  person: "Maya Chen",
  question: `Question ${id}`,
  outcome,
  sources,
  latency: "3.4 s",
});

describe("ActivityFilters", () => {
  const filters = [
    { value: "all" as const, label: "All", count: 214 },
    { value: "denied" as const, label: "Denied", count: 1 },
  ];
  it("shows counts, marks the active chip and reports changes", () => {
    const onChange = vi.fn();
    render(<ActivityFilters filters={filters} onChange={onChange} value="all" />);
    expect(screen.getByRole("button", { name: /All/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("214")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Denied/ }));
    expect(onChange).toHaveBeenCalledWith("denied");
  });
});

describe("ActivityTable", () => {
  it("renders column headers and an outcome label per row, with a placeholder for missing sources", () => {
    render(<ActivityTable loadTrace={() => {}} rows={[row("a", "error", null), row("b", "no_evidence", 0)]} traces={{}} />);
    ["Time", "Person", "Question", "Outcome", "Sources", "Latency"].forEach((h) =>
      expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument(),
    );
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("No evidence")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("requests the trace on open, shows loading, then the trace grid, and closes", () => {
    const loadTrace = vi.fn();
    const rows = [row("a", "approved")];
    const { rerender } = render(<ActivityTable loadTrace={loadTrace} rows={rows} traces={{}} />);
    const btn = screen.getByRole("button", { name: /Question a/ });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(loadTrace).toHaveBeenCalledWith("a");
    expect(screen.getByText("Loading trace")).toBeInTheDocument();
    rerender(
      <ActivityTable
        loadTrace={loadTrace}
        rows={rows}
        traces={{ a: [{ step: "rewrite", detail: "p1 ticket", duration: "38 ms" }] }}
      />,
    );
    expect(screen.getByText("rewrite")).toBeInTheDocument();
    expect(screen.getByText("38 ms")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByText("rewrite")).toBeNull();
  });

  it("opens one row at a time and shows an explicit empty trace", () => {
    render(<ActivityTable loadTrace={() => {}} rows={[row("a", "answered"), row("b", "answered")]} traces={{ a: [], b: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: /Question a/ }));
    fireEvent.click(screen.getByRole("button", { name: /Question b/ }));
    expect(screen.getAllByText("No trace recorded")).toHaveLength(1);
  });

  it("offers Load more only with more pages and disables it while loading", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(<ActivityTable loadTrace={() => {}} rows={[]} traces={{}} />);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    rerender(<ActivityTable hasMore onLoadMore={onLoadMore} loadTrace={() => {}} rows={[]} traces={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalled();
    rerender(<ActivityTable hasMore loadingMore onLoadMore={onLoadMore} loadTrace={() => {}} rows={[]} traces={{}} />);
    expect(screen.getByRole("button", { name: "Load more" })).toBeDisabled();
  });
});

describe("empty and error states", () => {
  it("filtered empty offers Show all outcomes", () => {
    const onShowAll = vi.fn();
    render(<ActivityEmpty message="No denied actions this week" onShowAll={onShowAll} />);
    expect(screen.getByText("No denied actions this week")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all outcomes" }));
    expect(onShowAll).toHaveBeenCalled();
  });
  it("error is an alert with Retry", () => {
    const onRetry = vi.fn();
    render(<ActivityError onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load activity.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
