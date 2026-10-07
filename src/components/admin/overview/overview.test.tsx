import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { KpiView, SystemRowView } from "@/lib/contracts/admin-insights-view";

import { EvalsSummary } from "./evals-summary";
import { KpiStrip, sparklinePoints } from "./kpi-strip";
import { SystemHealth } from "./system-health";
import { UnansweredList } from "./unanswered-list";

const kpi = (id: string, points: number[]): KpiView => ({
  id,
  label: `Label ${id}`,
  value: "214",
  delta: "+12% on last week",
  points,
  startLabel: "Thu",
  endLabel: "Wed",
});

describe("sparklinePoints", () => {
  it("returns nothing for empty data", () => {
    expect(sparklinePoints([])).toBe("");
  });
  it("does not divide by zero on a flat or single series", () => {
    expect(sparklinePoints([5, 5, 5])).not.toContain("NaN");
    expect(sparklinePoints([5])).not.toContain("NaN");
  });
  it("puts the max at the top and spans the width", () => {
    const pts = sparklinePoints([1, 3]).split(" ");
    expect(pts[0]).toBe("0.0,26.0");
    expect(pts[1]).toBe("120.0,2.0");
  });
});

describe("KpiStrip", () => {
  it("renders label, value, delta and data-driven day labels", () => {
    render(<KpiStrip kpis={[kpi("a", [1, 2, 3]), { ...kpi("b", [3, 2]), startLabel: "Mon", endLabel: "Sun" }]} />);
    expect(screen.getByText("Label a")).toBeInTheDocument();
    expect(screen.getAllByText("+12% on last week")).toHaveLength(2);
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Sun")).toBeInTheDocument();
  });
});

describe("UnansweredList", () => {
  it("opens Add document with the row's item", () => {
    const onAdd = vi.fn();
    const item = { id: "u1", question: "Is there parking?", meta: "Last asked today", asks: 3 };
    render(<UnansweredList items={[item]} onAddDocument={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /Add document/ }));
    expect(onAdd).toHaveBeenCalledWith(item);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
  it("renders nothing but the header for an empty list", () => {
    render(<UnansweredList items={[]} onAddDocument={() => {}} />);
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});

describe("SystemHealth", () => {
  const rows: SystemRowView[] = [
    { id: "a", name: "Brain worker", status: "ok" },
    { id: "b", name: "AI Gateway", status: "warning", detail: "2 retries in the last hour" },
    { id: "c", name: "Vector index", status: "ok", detail: "Synced to g-c305cf57", mono: true },
  ];
  it("shows the warning count only when a row is not healthy", () => {
    const { rerender } = render(<SystemHealth rows={rows} />);
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    rerender(<SystemHealth rows={[rows[0], rows[2]]} />);
    expect(screen.queryByText(/warning/)).toBeNull();
  });
  it("counts errors as warnings too and uses mono for detail", () => {
    render(<SystemHealth rows={[{ id: "x", name: "Brain", status: "error", detail: "Down" }, ...rows]} />);
    expect(screen.getByText("2 warning")).toBeInTheDocument();
    expect(screen.getByText("Synced to g-c305cf57")).toHaveClass("font-mono");
    expect(within(screen.getAllByRole("listitem")[0]).getByText("Down")).toHaveClass("text-danger");
  });
});

describe("EvalsSummary", () => {
  it("shows leaks in success colour at zero and links to evals", () => {
    const onOpen = vi.fn();
    render(<EvalsSummary onOpenEvals={onOpen} summary={{ passed: 118, total: 120, aclLeaks: 0, latestRunLabel: "6 Sep 2026" }} />);
    expect(screen.getByText("0")).toHaveClass("text-success");
    expect(screen.getByText("Latest run 6 Sep 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open evals" }));
    expect(onOpen).toHaveBeenCalled();
  });
  it("never shows a leak count above zero as success", () => {
    render(<EvalsSummary onOpenEvals={() => {}} summary={{ passed: 1, total: 2, aclLeaks: 2, latestRunLabel: "x" }} />);
    expect(screen.getByText("2")).toHaveClass("text-danger");
  });
});
