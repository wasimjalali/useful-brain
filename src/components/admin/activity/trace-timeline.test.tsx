import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TraceStepView } from "@/lib/contracts/admin-insights-view";

import { TraceTimeline } from "./trace-timeline";

const GEN = "g-55d7d6cf-ace5-4784-ba6f-c6c03adb8556";
const steps: TraceStepView[] = [
  { step: "rewrite", detail: "queryTokens: 6", duration: "-" },
  {
    step: "retrieve",
    detail: `mode: hybrid · generation: ${GEN} · readable: 35 · candidates: 7 · searches: 3`,
    duration: "14000 ms",
  },
  { step: "rerank", detail: "floor: 0.05 · chunk1: c-1 · score1: 0.064 · wobble: 3", duration: "-" },
  {
    step: "generate",
    detail: "model: @cf/zai-org/glm-5.3-flash · citations: 0 · toolProposals: 0",
    duration: "43200 ms",
  },
  { step: "result", detail: "answerType: insufficient_evidence", duration: "-" },
];

describe("TraceTimeline", () => {
  it("shows readable step names and plain-word chips", () => {
    render(<TraceTimeline steps={steps} />);
    for (const name of ["Rewrite question", "Search", "Rerank", "Write answer", "Result"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    for (const chip of [
      "6 tokens",
      "Hybrid",
      "3 searches",
      "7 candidates",
      "35 readable documents",
      "Top score 0.064",
      "Floor 0.05",
      "0 citations",
      "0 ticket proposals",
    ]) {
      expect(screen.getByText(chip)).toBeInTheDocument();
    }
    expect(screen.queryByText(/queryTokens|toolProposals|score1/)).toBeNull();
  });

  it("shortens the generation and the model, keeping the raw ids in titles", () => {
    render(<TraceTimeline steps={steps} />);
    expect(screen.getByText("g-55d7d6cf")).toHaveAttribute("title", GEN);
    expect(screen.getByText("GLM 5.3 Flash")).toHaveAttribute("title", "@cf/zai-org/glm-5.3-flash");
  });

  it("formats durations in seconds, says instant, and scales the bars", () => {
    render(<TraceTimeline steps={steps} />);
    expect(screen.getByText("14.0 s")).toBeInTheDocument();
    expect(screen.getByText("43.2 s")).toBeInTheDocument();
    expect(screen.getAllByText("instant")).toHaveLength(2);
    expect(screen.getByTestId("bar-generate").style.width).toBe("100%");
    expect(screen.getByTestId("bar-retrieve").style.width).toBe("32%");
  });

  it("renders the result as an outcome pill and keeps unknown keys as humanized chips", () => {
    render(<TraceTimeline steps={steps} />);
    expect(screen.getByText("No evidence")).toBeInTheDocument();
    expect(screen.getByText("Wobble 3")).toBeInTheDocument();
  });

  it("shows the turn latency as the total, never a sum, and nothing when missing", () => {
    const { rerender } = render(<TraceTimeline steps={steps} total="43.2 s" />);
    expect(screen.getByText("43.2 s total")).toBeInTheDocument();
    expect(screen.queryByText(/57/)).toBeNull();
    rerender(<TraceTimeline steps={steps} total="-" />);
    expect(screen.queryByText(/total/)).toBeNull();
  });

  it("keeps an unknown step and a bare dash detail", () => {
    render(<TraceTimeline steps={[{ step: "new_step", detail: "-", duration: "-" }]} />);
    expect(screen.getByText("New step")).toBeInTheDocument();
  });
});
