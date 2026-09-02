import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EvaluationsWorkspace } from "./evaluations-workspace";

describe("EvaluationsWorkspace", () => {
  it("shows the locked 114/120 campaign and no run control", () => {
    render(<EvaluationsWorkspace />);

    expect(screen.getByRole("heading", { name: "Evals" })).toBeInTheDocument();
    expect(screen.getByText("114")).toBeInTheDocument();
    expect(screen.getByText("/120")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run evaluations" })).toBeNull();
  });

  it("filters remaining failures by category", () => {
    render(<EvaluationsWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: /Permission/ }));

    expect(screen.getByText("q073")).toBeInTheDocument();
    expect(screen.queryByText("q028")).toBeNull();
  });

  it("expands a failure and switches campaign runs", () => {
    render(<EvaluationsWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: /q028/ }));
    expect(
      screen.getByText(/Twin-document citation/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Baseline" }));
    expect(screen.getByText("77")).toBeInTheDocument();
    expect(
      screen.getByText("This run has no frozen per-question remainder."),
    ).toBeInTheDocument();
  });
});
