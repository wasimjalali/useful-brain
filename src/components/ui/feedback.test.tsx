import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Highlight } from "./highlight";
import { InlineAlert } from "./inline-alert";
import { Kbd } from "./kbd";
import { AnswerSkeleton, PassageSkeleton, TableRowsSkeleton } from "./skeleton";
import { StatusDot, StatusPill } from "./status";

describe("InlineAlert", () => {
  it("is an alert with the message and an optional action", () => {
    const onRetry = vi.fn();
    render(
      <InlineAlert action={{ label: "Retry", onClick: onRetry }}>
        The answer stopped before it finished. Your question is saved.
      </InlineAlert>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The answer stopped before it finished.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("Highlight", () => {
  it("renders a mark and reflects the active state", () => {
    const { rerender } = render(<Highlight>sixteen weeks</Highlight>);
    const mark = screen.getByText("sixteen weeks");
    expect(mark.tagName).toBe("MARK");
    expect(mark).not.toHaveAttribute("data-active", "true");
    rerender(<Highlight active>sixteen weeks</Highlight>);
    expect(screen.getByText("sixteen weeks")).toHaveAttribute("data-active", "true");
  });
});

describe("Skeleton presets", () => {
  it.each([
    ["answer", <AnswerSkeleton key="a" />],
    ["table rows", <TableRowsSkeleton key="t" rows={3} />],
    ["evidence passage", <PassageSkeleton key="p" />],
  ])("%s preset is aria-busy", (_name, node) => {
    const { container } = render(node);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("table rows preset renders the requested number of rows", () => {
    const { container } = render(<TableRowsSkeleton rows={5} />);
    expect(container.querySelectorAll("[data-skeleton-row]")).toHaveLength(5);
  });
});

describe("Status", () => {
  it("pill carries its tone", () => {
    render(<StatusPill tone="failed">Failed</StatusPill>);
    expect(screen.getByText("Failed")).toHaveAttribute("data-tone", "failed");
  });

  it("dot is decorative unless labelled", () => {
    const { container, rerender } = render(<StatusDot tone="success" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    rerender(<StatusDot label="Healthy" tone="success" />);
    expect(screen.getByRole("img", { name: "Healthy" })).toBeInTheDocument();
  });
});

describe("Kbd", () => {
  it("renders a kbd element", () => {
    render(<Kbd>esc</Kbd>);
    expect(screen.getByText("esc").tagName).toBe("KBD");
  });
});
