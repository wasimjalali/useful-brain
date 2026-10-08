// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SearchDialog } from "./search-dialog";

afterEach(cleanup);

const chats = [{ id: "c1", title: "Parental leave question", titleMatches: [[0, 8]] as [number, number][], dateLabel: "2d" }];
const documents = [
  { id: "d1", title: "Parental Leave Policy", titleMatches: [[0, 8]] as [number, number][], department: "HR", snippet: "Eligibility · Employees may…" },
  { id: "d2", title: "Leave and Time Off", titleMatches: [], department: "HR", snippet: null },
];

function setup(over: Partial<React.ComponentProps<typeof SearchDialog>> = {}) {
  const props = {
    query: "parental",
    chats,
    documents,
    loading: false,
    onQueryChange: vi.fn(),
    onOpenChat: vi.fn(),
    onOpenDocument: vi.fn(),
    onAskDocument: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<SearchDialog {...props} />);
  return props;
}

describe("SearchDialog", () => {
  it("is a combobox over a listbox with groups, footer count and bold matches", () => {
    setup();
    const input = screen.getByRole("combobox");
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option").length).toBe(3);
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0].id);
    expect(screen.getByText("1 chats · 2 documents")).toBeTruthy();
    expect(screen.getAllByText("Parental")[0].tagName).toBe("SPAN");
    expect(screen.getAllByText("Parental")[0].style.fontWeight).toBe("600");
  });

  it("moves with arrows, clamps at the ends and opens with Enter", () => {
    const p = setup();
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.onOpenDocument).toHaveBeenCalledWith("d1");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[2].getAttribute("aria-selected")).toBe("true");
  });

  it("opens a chat on Enter at the first row", () => {
    const p = setup();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(p.onOpenChat).toHaveBeenCalledWith("c1");
  });

  it("asks about a document with Cmd+Enter and does nothing on a chat row", () => {
    const p = setup();
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(p.onAskDocument).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(p.onAskDocument).toHaveBeenCalledWith("d1");
  });

  it("shows loading and empty states without options", () => {
    setup({ loading: true, chats: [], documents: [] });
    expect(screen.getByText("Searching")).toBeTruthy();
    expect(screen.queryAllByRole("option").length).toBe(0);
    cleanup();
    setup({ chats: [], documents: [] });
    expect(screen.getByText("No results for “parental”")).toBeTruthy();
  });

  it("closes on Escape", () => {
    const p = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(p.onClose).toHaveBeenCalled();
  });
});
