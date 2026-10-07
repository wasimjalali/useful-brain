// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const searchAll = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/app/library-actions", () => ({ searchAll: (q: string) => searchAll(q) }));
vi.mock("@/components/shell/shell-context", () => ({
  useShell: () => ({ conversations: [{ id: "c1", title: "Leave", createdAt: 0, updatedAt: Date.now() - 2 * 86_400_000 }] }),
}));

import { SearchHost } from "./search-host";

const result = {
  ok: true,
  data: {
    chats: [{ id: "c1", title: "Leave question", titleMatches: [[0, 5]], snippet: null }],
    documents: [{ id: "d1", title: "Leave Policy", department: "HR", titleMatches: [[0, 5]], snippet: "Eligibility · text" }],
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
});
