import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { EvalFailureView } from "@/lib/contracts/admin-insights-view";

import { CategoryBars } from "./category-bars";
import { EvalsFooter, ModelChip } from "./evals-footer";
import { FailuresList } from "./failures-list";
import { RetrievalMetrics } from "./retrieval-metrics";
import { RunsChart } from "./runs-chart";

const failure = (id: string): EvalFailureView => ({
  id,
  category: "Factual",
  question: "What is ERR-7702?",
  askedAs: "support_agent",
  expected: [{ document: "Core Error Code Reference", section: "Billing errors" }],
  note: "Exact token.",
});

describe("RunsChart", () => {
  const runs = [
    { id: "1", name: "Baseline", date: "30 Aug", passed: 77, total: 107 },
    { id: "2", name: "Latest", date: "6 Sep 2026", passed: 118, total: 120 },
  ];
  it("labels every point, fills only the latest and labels the gridlines", () => {
    render(<RunsChart runs={runs} />);
    expect(screen.getByText("77/107")).toBeInTheDocument();
    expect(screen.getByText("118/120")).toBeInTheDocument();
    expect(screen.getByText("Baseline")).toBeInTheDocument();
    ["100%", "90%", "80%", "70%", "60%"].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
    const dots = screen.getAllByTestId("run-dot");
    expect(dots.map((d) => d.dataset.filled)).toEqual(["false", "true"]);
  });
  it("survives one run and no runs without NaN", () => {
    const { container, rerender } = render(<RunsChart runs={[runs[0]]} />);
    expect(container.innerHTML).not.toContain("NaN");
    rerender(<RunsChart runs={[]} />);
    expect(container.innerHTML).not.toContain("NaN");
  });
  it("clamps a pass rate below the 60% floor", () => {
    const { container } = render(<RunsChart runs={[{ id: "z", name: "Bad", date: "d", passed: 1, total: 10 }]} />);
    expect(container.innerHTML).not.toContain("NaN");
  });
});

describe("CategoryBars", () => {
  it("shows passed/total and a zero-total category as empty", () => {
    render(<CategoryBars categories={[{ id: "a", name: "Factual", passed: 69, total: 70 }, { id: "b", name: "Empty", passed: 0, total: 0 }]} />);
    expect(screen.getByText("69/70")).toHaveClass("text-ink");
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });
});

describe("RetrievalMetrics", () => {
  it("colours ACL leaks in success and the rest ink", () => {
    render(<RetrievalMetrics metrics={[{ id: "a", label: "ACL leaks", value: "0", tone: "success" }, { id: "b", label: "MRR", value: "0.825" }]} />);
    expect(screen.getByText("0")).toHaveClass("text-success", "font-mono");
    expect(screen.getByText("0.825")).not.toHaveClass("text-success");
  });
});

describe("FailuresList", () => {
  it("expands and collapses with aria-expanded and rotates the chevron", () => {
    render(<FailuresList failures={[failure("q093")]} />);
    const btn = screen.getByRole("button", { name: /q093/ });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Asked as")).toBeNull();
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Support agent")).toBeInTheDocument();
    expect(screen.queryByText("support_agent")).toBeNull();
    expect(screen.getByText("Factual", { selector: "span.rounded-md" })).toBeInTheDocument();
    expect(screen.getByText("Looks for")).toBeInTheDocument();
    expect(screen.getByText("Exact token.")).toBeInTheDocument();
    expect(screen.getByTestId("failure-chevron")).toHaveStyle({ transform: "rotate(90deg)" });
    fireEvent.click(btn);
    expect(screen.queryByText("Asked as")).toBeNull();
  });
  it("can start open and keeps rows independent", () => {
    render(<FailuresList failures={[failure("q093"), failure("q120")]} initiallyOpenId="q093" />);
    expect(screen.getAllByText("Asked as")).toHaveLength(1);
  });
});

describe("footer and chip", () => {
  it("shows the read-only note and command", () => {
    render(<><ModelChip model="@cf/zai-org/glm-5.3-flash" /><EvalsFooter /></>);
    expect(screen.getByText("GLM 5.3 Flash")).toBeInTheDocument();
    expect(screen.queryByText("@cf/zai-org/glm-5.3-flash")).toBeNull();
    expect(screen.getByTitle("@cf/zai-org/glm-5.3-flash")).toBeInTheDocument();
    expect(screen.getByText("Read-only here. Run the suite from the repo:")).toBeInTheDocument();
    expect(screen.getByText("npm run eval:northwind")).toHaveClass("font-mono");
  });
});
