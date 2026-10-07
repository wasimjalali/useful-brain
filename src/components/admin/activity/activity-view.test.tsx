import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityPage } from "@/app/admin-insights-actions";

const loadActivity = vi.fn();
const loadTrace = vi.fn();
vi.mock("@/app/admin-insights-actions", () => ({
  loadActivityAction: (...a: unknown[]) => loadActivity(...a),
  loadActivityTraceAction: (...a: unknown[]) => loadTrace(...a),
}));

import { ActivityView } from "./activity-view";

const filters = [
  { value: "all" as const, label: "All", count: 3 },
  { value: "denied" as const, label: "Denied", count: 0 },
];
const row = (id: string) => ({ id, time: "09:42", person: "Maya", question: `Question ${id}`, outcome: "answered" as const, sources: 1, latency: "3.4 s" });
const page = (over: Partial<ActivityPage> = {}): ActivityPage => ({ rows: [row("a")], filters, nextCursor: "c1", ...over });

beforeEach(() => {
  loadActivity.mockReset();
  loadTrace.mockReset();
});

describe("ActivityView", () => {
  it("shows the error alert when the first load failed and retries", async () => {
    loadActivity.mockResolvedValue({ ok: true, data: page() });
    render(<ActivityView initial={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load activity");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Question a")).toBeInTheDocument());
    expect(loadActivity).toHaveBeenCalledWith({ outcome: "all", cursor: null });
  });

  it("appends the next page using the cursor", async () => {
    loadActivity.mockResolvedValue({ ok: true, data: page({ rows: [row("b")], nextCursor: null }) });
    render(<ActivityView initial={page()} />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByText("Question b")).toBeInTheDocument());
    expect(screen.getByText("Question a")).toBeInTheDocument();
    expect(loadActivity).toHaveBeenCalledWith({ outcome: "all", cursor: "c1" });
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("loads a trace only when a row opens, once", async () => {
    loadTrace.mockResolvedValue({ ok: true, data: [{ step: "retrieve", detail: "chunks: 6", duration: "420 ms" }] });
    render(<ActivityView initial={page()} />);
    expect(loadTrace).not.toHaveBeenCalled();
    const toggle = screen.getByRole("button", { name: /Question a/ });
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText("chunks: 6")).toBeInTheDocument());
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(loadTrace).toHaveBeenCalledTimes(1);
    expect(loadTrace).toHaveBeenCalledWith("a");
  });

  it("shows a visible failure line when the trace cannot load", async () => {
    loadTrace.mockResolvedValue({ ok: false, error: { code: "INTERNAL_ERROR", message: "x", retryable: true } });
    render(<ActivityView initial={page()} />);
    fireEvent.click(screen.getByRole("button", { name: /Question a/ }));
    await waitFor(() => expect(screen.getByText("Could not load this trace")).toBeInTheDocument());
  });

  it("shows the filtered empty state and returns to all outcomes", async () => {
    loadActivity.mockResolvedValueOnce({ ok: true, data: page({ rows: [], nextCursor: null }) });
    render(<ActivityView initial={page()} />);
    fireEvent.click(screen.getByRole("button", { name: /Denied/ }));
    await waitFor(() => expect(screen.getByText("No denied actions this week")).toBeInTheDocument());
    expect(loadActivity).toHaveBeenCalledWith({ outcome: "denied", cursor: null });
    loadActivity.mockResolvedValueOnce({ ok: true, data: page() });
    fireEvent.click(screen.getByRole("button", { name: "Show all outcomes" }));
    await waitFor(() => expect(screen.getByText("Question a")).toBeInTheDocument());
    expect(loadActivity).toHaveBeenLastCalledWith({ outcome: "all", cursor: null });
  });
});
