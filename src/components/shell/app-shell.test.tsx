import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { actionSuccess } from "@/lib/rag/app-errors";
import { emptyEmbeddingStorageStatus } from "@/lib/rag/storage-records";

const nav = vi.hoisted(() => ({
  pathname: "/chat",
  search: "",
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn() }),
  useParams: () => ({}),
}));

vi.mock("@/app/library-actions", () => ({ searchAll: vi.fn() }));

import { ChatComposer } from "@/components/chat/chat-composer";

import { AppShell } from "./app-shell";
import { ShellPanel, useShell } from "./shell-context";
import { admin, clearViewport, member, setViewport } from "./test-support";

const conversation = {
  id: "c1",
  title: "Parental leave",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

type ShellOptions = {
  identity?: typeof member;
  children?: React.ReactNode;
  deleteConversationAction?: () => Promise<ReturnType<typeof actionSuccess<null>>>;
};

function shellElement(options: ShellOptions = {}) {
  return (
    <AppShell
      deleteConversationAction={options.deleteConversationAction ?? (async () => actionSuccess(null))}
      embeddingStorageStatus={emptyEmbeddingStorageStatus}
      identity={options.identity ?? member}
      initialConversations={[conversation]}
      retrievalMode="keyword"
      retrievalReady
    >
      {options.children ?? <p>page content</p>}
    </AppShell>
  );
}

function renderShell(options: ShellOptions = {}) {
  return render(shellElement(options));
}

function press(key: string, init: KeyboardEventInit = {}, target: Element = document.body) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  nav.pathname = "/chat";
  nav.search = "";
  nav.push.mockClear();
  nav.replace.mockClear();
  clearViewport();
});

afterEach(() => {
  clearViewport();
  vi.unstubAllGlobals();
});

describe("global shortcuts", () => {
  it("opens search on Ctrl+K off the Mac and starts a new chat on Ctrl+N", () => {
    renderShell();
    const search = press("k", { ctrlKey: true });
    expect(search.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    press("n", { ctrlKey: true });
    expect(nav.push).toHaveBeenCalledWith("/chat");
  });

  it("uses ⌘ on a Mac and ignores Ctrl there", () => {
    vi.stubGlobal("navigator", { ...navigator, platform: "MacIntel" });
    renderShell();
    press("k", { ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
    press("k", { metaKey: true });
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });

  it("does not hijack the keys inside a text field", () => {
    renderShell({ children: <input aria-label="Other field" /> });
    const input = screen.getByLabelText("Other field");
    const event = press("k", { ctrlKey: true }, input);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it("still works inside the composer", () => {
    renderShell({
      children: (
        <ChatComposer onChange={() => {}} onSend={() => {}} pending={false} placeholder="Ask" value="" />
      ),
    });
    const event = press("k", { ctrlKey: true }, screen.getByLabelText("Question"));
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });

  it("ignores extra modifiers and unrelated keys", () => {
    renderShell();
    press("k", { ctrlKey: true, shiftKey: true });
    press("k", { ctrlKey: true, altKey: true });
    press("j", { ctrlKey: true });
    press("k");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("stays quiet while a dialog is already open", () => {
    renderShell();
    press("k", { ctrlKey: true });
    press("n", { ctrlKey: true });
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("shell title heading", () => {
  it("is a span on /library at 1000px so the page header owns the only h1", () => {
    setViewport(1000);
    nav.pathname = "/library";
    renderShell({ children: <h1>Library</h1> });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(document.querySelector(".ub-header-title")?.tagName).toBe("SPAN");
  });

  it("is the h1 on a conversation at 1000px", () => {
    setViewport(1000);
    nav.pathname = "/chat/c1";
    renderShell();
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Parental leave");
  });
});

describe("slide-over rail", () => {
  it("is a plain complementary rail at 1200px and wider", () => {
    setViewport(1440);
    renderShell();
    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close menu" })).toBeNull();
  });

  it("opens as a modal dialog below 1200px and closes on Escape with focus restored", () => {
    setViewport(900);
    renderShell();
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes when the scrim is clicked", () => {
    setViewport(390);
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
  });

  it("closes from the in-rail close button", () => {
    setViewport(390);
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
  });

  it("traps Tab inside the open rail", () => {
    setViewport(390);
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
    );
    const last = focusable[focusable.length - 1];
    last.focus();
    const event = press("Tab", {}, last);
    expect(event.defaultPrevented).toBe(true);
    expect(focusable[0]).toHaveFocus();

    focusable[0].focus();
    const back = press("Tab", { shiftKey: true }, focusable[0]);
    expect(back.defaultPrevented).toBe(true);
    expect(last).toHaveFocus();
  });

  it("closes after choosing a saved chat", () => {
    setViewport(390);
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    fireEvent.click(within(dialog).getByRole("link", { name: "Parental leave" }));
    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
  });

  it("gives the header 44px-target buttons and the page title", () => {
    setViewport(390);
    renderShell();
    expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "New chat" }).length).toBeGreaterThan(0);
    expect(document.querySelector(".ub-header-title")).toHaveTextContent("New chat");
  });
});

describe("evidence slot", () => {
  function PanelPage({ open = true }: { open?: boolean }) {
    return (
      <ShellPanel label="Evidence" onClose={onClosePanel} open={open}>
        <button type="button">Panel action</button>
      </ShellPanel>
    );
  }
  const onClosePanel = vi.fn();
  beforeEach(() => onClosePanel.mockClear());

  it("is a 380px second stage beside the page at 1200px and wider", () => {
    setViewport(1440);
    renderShell({ children: <PanelPage /> });
    const panel = document.querySelector(".ub-panel") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(within(panel).getByRole("button", { name: "Panel action" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Evidence" })).toBeNull();
  });

  it("closes the side panel on Escape", () => {
    setViewport(1440);
    renderShell({ children: <PanelPage /> });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClosePanel).toHaveBeenCalledOnce();
  });

  it("is a right sheet between 768px and 1199px, closed by its scrim", () => {
    setViewport(1000);
    renderShell({ children: <PanelPage /> });
    const sheet = screen.getByRole("dialog", { name: "Evidence" });
    expect(sheet).toHaveClass("ub-sheet-right");
    expect(within(sheet).getByRole("button", { name: "Panel action" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close sheet" }));
    expect(onClosePanel).toHaveBeenCalledOnce();
  });

  it("is a bottom sheet with a grabber below 768px and closes on Escape", () => {
    setViewport(390);
    renderShell({ children: <PanelPage /> });
    const sheet = screen.getByRole("dialog", { name: "Evidence" });
    expect(sheet).toHaveClass("ub-sheet-bottom");
    expect(sheet.querySelector(".ub-grabber")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClosePanel).toHaveBeenCalledOnce();
  });

  it("mounts only one evidence view and nothing when closed", () => {
    setViewport(1000);
    const { unmount } = renderShell({ children: <PanelPage /> });
    expect(screen.getAllByRole("button", { name: "Panel action" })).toHaveLength(1);
    unmount();
    renderShell({ children: <PanelPage open={false} /> });
    expect(screen.queryByRole("button", { name: "Panel action" })).toBeNull();
    expect(document.querySelector(".ub-panel, .ub-sheet-right, .ub-sheet-bottom")).toBeNull();
  });
});

describe("settings and chats", () => {
  it("opens the settings dialog from ?settings=1 and closes by dropping the param", () => {
    setViewport(1400);
    nav.search = "settings=1";
    renderShell();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    const replaceState = vi.spyOn(window.history, "replaceState");
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(replaceState).toHaveBeenCalledWith(null, "", "/chat");
    expect(nav.replace).not.toHaveBeenCalled();
    replaceState.mockRestore();
  });

  it("opens settings from the gear by adding ?settings=1", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    // No router navigation: it would remount the chat and drop an in-flight answer.
    expect(pushState).toHaveBeenCalledWith(null, "", "/chat?settings=1");
    expect(nav.push).not.toHaveBeenCalled();
    pushState.mockRestore();
  });

  it("deletes a chat, drops it from the rail and leaves the deleted chat's page", async () => {
    nav.pathname = "/chat/c1";
    const deleteConversationAction = vi.fn(async () => actionSuccess(null));
    renderShell({ deleteConversationAction });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete chat: Parental leave" }));
    });
    expect(deleteConversationAction).toHaveBeenCalledWith("c1");
    expect(screen.queryByRole("link", { name: "Parental leave" })).toBeNull();
    expect(nav.push).toHaveBeenCalledWith("/chat");
  });

  it("makes New chat the active row, and no conversation, once New chat is chosen", () => {
    nav.pathname = "/chat/c1";
    renderShell();
    const rail = () => document.querySelector("#app-rail") as HTMLElement;
    expect(within(rail()).getByRole("link", { name: "Parental leave" })).toHaveAttribute("aria-current", "page");
    expect(within(rail()).getByRole("link", { name: /New chat/ })).not.toHaveAttribute("aria-current");

    window.history.replaceState(null, "", "/chat/c1");
    fireEvent.click(within(rail()).getByRole("link", { name: /New chat/ }));
    expect(within(rail()).getByRole("link", { name: "Parental leave" })).not.toHaveAttribute("aria-current");
    expect(within(rail()).getByRole("link", { name: /New chat/ })).toHaveAttribute("aria-current", "page");
    // The address bar says /chat too, so a reload opens the blank chat.
    expect(window.location.pathname).toBe("/chat");
  });

  it("skips the /chat history entry when the caller navigates itself", () => {
    nav.pathname = "/chat/c1";
    const push = vi.spyOn(window.history, "pushState");
    window.history.replaceState(null, "", "/chat/c1");
    function Ask() {
      const { newChat } = useShell();
      return <button onClick={() => newChat({ pushUrl: false })}>ask</button>;
    }
    renderShell({ children: <Ask /> });
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    expect(push).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/chat/c1");
    push.mockRestore();
  });

  it("follows the conversation again when the user opens it from elsewhere", () => {
    nav.pathname = "/chat/c1";
    const view = renderShell();
    const rail = () => document.querySelector("#app-rail") as HTMLElement;
    fireEvent.click(within(rail()).getByRole("link", { name: /New chat/ }));
    nav.pathname = "/library";
    view.rerender(shellElement());
    nav.pathname = "/chat/c1";
    view.rerender(shellElement());
    expect(within(rail()).getByRole("link", { name: "Parental leave" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the chat and shows the error when delete fails", async () => {
    const deleteConversationAction = vi.fn(async () => ({
      ok: false as const,
      error: { code: "INTERNAL_ERROR" as const, message: "Could not delete.", retryable: true },
    }));
    renderShell({
      deleteConversationAction: deleteConversationAction as never,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete chat: Parental leave" }));
    });
    expect(screen.getByRole("link", { name: "Parental leave" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not delete.");
  });

  it("shows the admin group to an admin only", () => {
    const { unmount } = renderShell({ identity: admin });
    expect(screen.getByRole("link", { name: "Activity" })).toBeInTheDocument();
    unmount();
    renderShell();
    expect(screen.queryByRole("link", { name: "Activity" })).toBeNull();
  });
});
