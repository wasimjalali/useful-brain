import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "./dialog";

describe("Dialog", () => {
  it("is a modal dialog with a name and the requested pixel width", () => {
    render(
      <Dialog ariaLabel="Upload documents" onClose={() => {}} width={560}>
        <button type="button">Add to draft</button>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Upload documents" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveStyle({ width: "560px" });
  });

  it("keeps the legacy maxWidth class API", () => {
    render(
      <Dialog ariaLabel="Settings" maxWidth="max-w-3xl" onClose={() => {}}>
        <button type="button">Close</button>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Settings" })).toHaveClass("max-w-3xl");
  });

  it("closes on Esc", () => {
    const onClose = vi.fn();
    render(
      <Dialog ariaLabel="Search" onClose={onClose} width={640}>
        <input aria-label="Query" />
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the scrim is clicked but not the panel", () => {
    const onClose = vi.fn();
    render(
      <Dialog ariaLabel="Search" onClose={onClose} width={640}>
        <button type="button">Inside</button>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Inside" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus in, traps Tab and restores focus on unmount", () => {
    const opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <Dialog ariaLabel="Trap" onClose={() => {}} width={400}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </Dialog>,
    );
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
