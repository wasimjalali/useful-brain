// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const searchAll = vi.fn();
const newChat = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/app/library-actions", () => ({ searchAll: (q: string) => searchAll(q) }));
vi.mock("@/components/shell/shell-context", () => ({
  useShell: () => ({ newChat, conversations: [{ id: "c1", title: "Leave", createdAt: 0, updatedAt: Date.now() - 2 * 86_400_000 }] }),
}));

import { groupChatsByTitle, SearchHost } from "./search-host";

const result = {
  ok: true,
  data: {
    chats: [{ id: "c1", title: "Leave question", titleMatches: [[0, 5]], snippet: null }],
    documents: [{ id: "d1", title: "Leave Policy", department: "hr", titleMatches: [[0, 5]], snippet: "Eligibility · text" }],
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  searchAll.mockResolvedValue(result);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  push.mockReset();
  searchAll.mockReset();
  newChat.mockReset();
});

async function type(value: string) {
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value } });
  return input;
}
async function settle(ms = 200) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("SearchHost", () => {
  it("does not search under 2 characters", async () => {
    render(<SearchHost onClose={vi.fn()} />);
    await type("l");
    await settle(500);
    expect(searchAll).not.toHaveBeenCalled();
  });

  it("debounces by 200ms and sends only the last query", async () => {
    render(<SearchHost onClose={vi.fn()} />);
    await type("le");
    await settle(150);
    await type("lea");
    await settle(150);
    expect(searchAll).not.toHaveBeenCalled();
    await settle(60);
    expect(searchAll).toHaveBeenCalledTimes(1);
    expect(searchAll).toHaveBeenCalledWith("lea");
    expect(screen.getAllByText("Leave", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByRole("option", { name: /Leave Policy/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Leave Policy/ })).toHaveTextContent("HR");
  });

  it("Enter opens a chat, then a document in the reader", async () => {
    const onClose = vi.fn();
    render(<SearchHost onClose={onClose} />);
    const input = await type("lea");
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenLastCalledWith("/chat/c1");
    expect(onClose).toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenLastCalledWith("/chat?doc=d1");
  });

  it("Cmd+Enter on a document starts a scoped chat and does nothing on a chat", async () => {
    render(<SearchHost onClose={vi.fn()} />);
    const input = await type("lea");
    await settle();
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(push).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(push).toHaveBeenLastCalledWith("/chat?scope=d1");
    // A fresh chat, so the scope applies to the first turn and not to an old conversation.
    expect(newChat).toHaveBeenCalledOnce();
    // push follows, so newChat must not add its own /chat history entry.
    expect(newChat).toHaveBeenCalledWith({ pushUrl: false });
    expect(newChat.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]);
  });

  it("does not start a new chat when opening a chat or a document", async () => {
    render(<SearchHost onClose={vi.fn()} />);
    const input = await type("lea");
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(newChat).not.toHaveBeenCalled();
  });

  it("shows a failed search as an alert, not as no results", async () => {
    searchAll.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Search is unavailable.", retryable: true },
    });
    render(<SearchHost onClose={vi.fn()} />);
    await type("lea");
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Search is unavailable.");
    expect(screen.queryByText(/No results/)).toBeNull();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<SearchHost onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores a stale response", async () => {
    let first: (v: unknown) => void = () => undefined;
    searchAll.mockReturnValueOnce(new Promise((r) => (first = r)));
    render(<SearchHost onClose={vi.fn()} />);
    await type("lea");
    await settle();
    searchAll.mockResolvedValueOnce({ ok: true, data: { chats: [], documents: [] } });
    await type("leav");
    await settle();
    await act(async () => first(result));
    expect(screen.queryByText("Leave Policy", { exact: false })).toBeNull();
  });

  it("groups chats that share a title and opens the most recent one", async () => {
    searchAll.mockResolvedValue({
      ok: true,
      data: {
        chats: [
          { id: "a", title: "Refund window", titleMatches: [[0, 6]], snippet: null },
          { id: "b", title: "  refund   WINDOW ", titleMatches: [[2, 8]], snippet: null },
          { id: "c", title: "Leave", titleMatches: [], snippet: null },
        ],
        documents: [],
      },
    });
    render(<SearchHost onClose={vi.fn()} />);
    await type("re");
    await settle();
    expect(screen.getAllByRole("option").length).toBe(2);
    expect(screen.getByText("2 chats")).toBeInTheDocument();
    expect(screen.getByText("2 chats · 0 documents")).toBeInTheDocument();
  });
});

describe("groupChatsByTitle", () => {
  const hit = (id: string, title: string) => ({ id, title, titleMatches: [] as [number, number][], snippet: null });
  const now = 10 * 86_400_000;

  it("merges normalized titles, targets the most recently updated chat and counts them", () => {
    const rows = groupChatsByTitle(
      [hit("a", "Refund?"), hit("b", " refund?  "), hit("c", "REFUND?"), hit("d", "Other")],
      new Map([["a", 1], ["b", 9 * 86_400_000], ["c", 5], ["d", 2]]),
      now,
    );
    expect(rows.map((r) => r.id)).toEqual(["b", "d"]);
    expect(rows[0].count).toBe(3);
    expect(rows[1].count).toBeUndefined();
  });

  it("leaves distinct titles untouched and in order", () => {
    const rows = groupChatsByTitle([hit("a", "One"), hit("b", "Two")], new Map(), now);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows.every((r) => r.count === undefined)).toBe(true);
  });

  it("keeps the first hit when no dates are known", () => {
    const rows = groupChatsByTitle([hit("a", "Same"), hit("b", "same")], new Map(), now);
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("keeps the server's first hit when its timestamp is missing from a stale cache", () => {
    const rows = groupChatsByTitle(
      [hit("new", "Same"), hit("old", "same")],
      new Map([["old", 1]]),
      now,
    );
    expect(rows.map((r) => r.id)).toEqual(["new"]);
    expect(rows[0].count).toBe(2);
  });
});
