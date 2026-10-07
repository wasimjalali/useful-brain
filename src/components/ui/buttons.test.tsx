import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button, IconButton } from "./button";
import { CitationChip } from "./citation-chip";
import { FilterChip } from "./filter-chip";
import { XIcon } from "@/components/icons";

describe("Button", () => {
  it("renders a named button with the chosen variant and size", () => {
    render(<Button variant="primary" size={36}>Approve and run</Button>);
    const button = screen.getByRole("button", { name: "Approve and run" });
    expect(button).toHaveAttribute("data-variant", "primary");
    expect(button).toHaveAttribute("data-size", "36");
    expect(button).toHaveAttribute("type", "button");
  });

  it("does not fire when disabled", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Retry</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
  });

  it("keeps the label next to an icon", () => {
    render(<Button variant="secondary" icon={<XIcon data-testid="icon" />}>Retry</Button>);
    expect(screen.getByRole("button", { name: "Retry" })).toContainElement(screen.getByTestId("icon"));
  });
});

describe("IconButton", () => {
  it("is named by its aria-label", () => {
    render(<IconButton aria-label="Copy answer"><XIcon /></IconButton>);
    expect(screen.getByRole("button", { name: "Copy answer" })).toBeInTheDocument();
  });
});

describe("FilterChip", () => {
  it("exposes pressed state and the count", () => {
    const onClick = vi.fn();
    render(<FilterChip pressed count={12} onClick={onClick}>Engineering</FilterChip>);
    const chip = screen.getByRole("button", { name: /Engineering/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveTextContent("12");
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is not pressed by default", () => {
    render(<FilterChip>HR</FilterChip>);
    expect(screen.getByRole("button", { name: "HR" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("CitationChip", () => {
  it("is a button named Citation n", () => {
    render(<CitationChip n={1} />);
    expect(screen.getByRole("button", { name: "Citation 1" })).toHaveTextContent("1");
  });

  it("marks the active state and reports hover and click", () => {
    const onHover = vi.fn();
    const onClick = vi.fn();
    render(<CitationChip n={2} active onHover={onHover} onClick={onClick} />);
    const chip = screen.getByRole("button", { name: "Citation 2" });
    expect(chip).toHaveAttribute("data-active", "true");
    fireEvent.mouseEnter(chip);
    expect(onHover).toHaveBeenCalledWith(true);
    fireEvent.mouseLeave(chip);
    expect(onHover).toHaveBeenCalledWith(false);
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
