import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Rail, type RailProps } from "./rail";
import { admin, member } from "./test-support";

// Local-time constructor so grouping holds in any timezone.
const NOW = new Date(2026, 9, 8, 15, 30).getTime();
const at = (day: number, hour = 9) => new Date(2026, 9, day, hour).getTime();

const chat = (id: string, title: string, updatedAt: number) => ({
  id,
  title,
  createdAt: updatedAt,
  updatedAt,
});

function renderRail(props: Partial<RailProps> = {}) {
  const handlers = {
    onDeleteConversation: vi.fn(),
    onNewChat: vi.fn(),
    onSearch: vi.fn(),
    onSettings: vi.fn(),
  };
  render(
    <Rail
      conversations={[]}
      identity={member}
      now={NOW}
      pathname="/chat"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("Rail", () => {
  it("shows the account name in the profile row, and the subject when there is none", () => {
    renderRail({ identity: { ...member, subject: "maya.chen@northwind.example", name: "Maya R. Chen" } });
    expect(screen.getByText("Maya R. Chen")).toBeInTheDocument();
    cleanup();
    renderRail({ identity: { ...member, subject: "dev@localhost", name: null } });
    expect(screen.getByText("dev@localhost")).toBeInTheDocument();
  });

  it("lists New chat, Search and Library in a fixed order for a member", () => {
    renderRail();
    const primary = screen.getByRole("navigation", { name: "Primary" });
    const labels = Array.from(primary.querySelectorAll("a, button")).map(
      (element) => element.querySelector(".ub-row-label")?.textContent,
    );
    expect(labels).toEqual(["New chat", "Search", "Library"]);
    expect(screen.getByRole("link", { name: /New chat/ })).toHaveAttribute("href", "/chat");
    expect(screen.getByRole("link", { name: /Library/ })).toHaveAttribute("href", "/library");
  });

  it("hides the whole Admin group from a member", () => {
    renderRail();
    expect(screen.queryByRole("navigation", { name: "Admin" })).toBeNull();
    for (const name of ["Overview", "Sources", "People", "Evals", "Activity"]) {
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
  });

  it("shows Overview, Sources, People, Evals and Activity to an admin, in order", () => {
    renderRail({ identity: admin });
    const group = screen.getByRole("navigation", { name: "Admin" });
    expect(within(group).getByText("Admin")).toBeInTheDocument();
    const links = within(group).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Overview",
      "Sources",
      "People",
      "Evals",
      "Activity",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/admin/overview",
      "/admin/sources",
      "/admin/people",
      "/admin/evals",
      "/admin/activity",
    ]);
  });

  it("groups chats into Today and Previous 7 days and keeps older ones reachable", () => {
    renderRail({
      conversations: [
        chat("a", "Parental leave", at(8, 10)),
        chat("b", "Refund window", at(3)),
        chat("c", "Halvorsen sync", at(5)),
        chat("d", "Old onboarding", at(1) - 20 * 86_400_000),
      ],
    });
    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Parental leave",
    ]);
    const week = screen.getByRole("region", { name: "Previous 7 days" });
    expect(within(week).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Halvorsen sync",
      "Refund window",
    ]);
    const older = screen.getByRole("region", { name: "Older" });
    expect(within(older).getByRole("link", { name: "Old onboarding" })).toHaveAttribute(
      "href",
      "/chat/d",
    );
  });

  it("shows the first-visit empty state and no group labels without chats", () => {
    renderRail();
    expect(screen.getByText("Questions you ask show up here.")).toBeInTheDocument();
    expect(screen.queryByText("Today")).toBeNull();
  });

  it("marks only the active row with aria-current", () => {
    renderRail({
      conversations: [chat("a", "Parental leave", at(8)), chat("b", "Refund window", at(8, 8))],
      identity: admin,
      pathname: "/chat/b",
    });
    const current = document.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Refund window");
  });

  it("marks New chat on /chat, Library on /library and Sources on /admin/sources", () => {
    const { unmount } = render(
      <Rail
        conversations={[]}
        identity={admin}
        now={NOW}
        onDeleteConversation={vi.fn()}
        onNewChat={vi.fn()}
        onSearch={vi.fn()}
        onSettings={vi.fn()}
        pathname="/chat"
      />,
    );
    expect(screen.getByRole("link", { name: /New chat/ })).toHaveAttribute("aria-current", "page");
    unmount();
    renderRail({ identity: admin, pathname: "/admin/sources" });
    expect(screen.getByRole("link", { name: "Sources" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /New chat/ })).not.toHaveAttribute("aria-current");
  });

  it("shows the profile row with department, or Admin for an admin", () => {
    const { unmount } = render(
      <Rail
        conversations={[]}
        identity={member}
        now={NOW}
        onDeleteConversation={vi.fn()}
        onNewChat={vi.fn()}
        onSearch={vi.fn()}
        onSettings={vi.fn()}
        pathname="/chat"
      />,
    );
    expect(screen.getByText("Maya Chen")).toBeInTheDocument();
    expect(screen.getByText("Support")).toBeInTheDocument();
    expect(screen.getByText("MC")).toBeInTheDocument();
    unmount();
    renderRail({ identity: admin });
    expect(screen.getByText("Jordan Ellis")).toBeInTheDocument();
    expect(screen.getByText("Admin", { selector: ".ub-profile-role" })).toBeInTheDocument();
  });

  it("wires Search, Settings, New chat and chat delete", () => {
    const handlers = renderRail({ conversations: [chat("a", "Parental leave", at(8))] });
    fireEvent.click(screen.getByRole("button", { name: /Search/ }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("link", { name: /New chat/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete chat: Parental leave" }));
    expect(handlers.onSearch).toHaveBeenCalledOnce();
    expect(handlers.onSettings).toHaveBeenCalledOnce();
    expect(handlers.onNewChat).toHaveBeenCalledOnce();
    expect(handlers.onDeleteConversation).toHaveBeenCalledWith("a");
  });

  it("shows a close button only as a slide-over and names the dialog when modal", () => {
    renderRail();
    expect(screen.queryByRole("button", { name: "Close menu" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a modal dialog while the slide-over is open", () => {
    renderRail({ modal: true, overlay: true });
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("button", { name: "Close menu" })).toBeInTheDocument();
  });
});
