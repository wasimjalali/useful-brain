import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UsefulBrainAvatar, UsefulBrainLogo, UsefulBrainMark } from "./useful-brain-logo";

describe("UsefulBrainLogo", () => {
  it("renders the mark and wordmark lockup", () => {
    render(<UsefulBrainLogo />);
    expect(screen.getByLabelText("Useful Brain")).toBeInTheDocument();
    expect(screen.getByText("Useful Brain")).toBeInTheDocument();
  });

  it("hides the wordmark when compact", () => {
    render(<UsefulBrainLogo compact />);
    expect(screen.getByLabelText("Useful Brain")).toBeInTheDocument();
    expect(screen.queryByText("Useful Brain")).not.toBeInTheDocument();
  });

  it("uses the document mark viewBox", () => {
    const { container } = render(<UsefulBrainMark />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 220 242");
  });

  it("places the inverted mark on a brand tile for avatars", () => {
    const { container } = render(<UsefulBrainAvatar />);
    expect(container.querySelector(".bg-brand")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 220 242");
  });
});
