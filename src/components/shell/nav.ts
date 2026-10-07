import type { ComponentType, SVGProps } from "react";

import {
  ActivityIcon,
  ClipboardCheckIcon,
  DatabaseIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  SearchIcon,
  SquarePenIcon,
  UsersIcon,
} from "@/components/icons";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: Icon;
  /** Single-letter shortcut shown as ⌘ + letter. */
  shortcut?: string;
};

/** Fixed order. It never changes between pages or roles. */
export const PRIMARY_NAV: NavItem[] = [
  { id: "new", label: "New chat", href: "/chat", icon: SquarePenIcon, shortcut: "N" },
  { id: "search", label: "Search", href: "", icon: SearchIcon, shortcut: "K" },
  { id: "library", label: "Library", href: "/library", icon: LibraryIcon },
];

export const ADMIN_NAV: NavItem[] = [
  { id: "overview", label: "Overview", href: "/admin/overview", icon: LayoutDashboardIcon },
  { id: "sources", label: "Sources", href: "/admin/sources", icon: DatabaseIcon },
  { id: "people", label: "People", href: "/admin/people", icon: UsersIcon },
  { id: "evals", label: "Evals", href: "/admin/evals", icon: ClipboardCheckIcon },
  { id: "activity", label: "Activity", href: "/admin/activity", icon: ActivityIcon },
];

const TITLES: Record<string, string> = {
  "/library": "Library",
  "/admin/overview": "Overview",
  "/admin/sources": "Sources",
  "/admin/people": "People",
  "/admin/evals": "Evals",
  "/admin/activity": "Activity",
};

/** Pages that share one mounted view. `/chat` and `/chat/[id]` are one chat. */
export function routeFamily(pathname: string): string {
  return pathname === "/chat" || pathname.startsWith("/chat/") ? "/chat" : pathname;
}

export function conversationIdFromPath(pathname: string): string | null {
  const match = /^\/chat\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function titleForPath(
  pathname: string,
  conversations: ReadonlyArray<{ id: string; title: string }>,
): string {
  const id = conversationIdFromPath(pathname);
  if (id) {
    return conversations.find((conversation) => conversation.id === id)?.title ?? "Chat";
  }
  if (pathname === "/chat") {
    return "New chat";
  }
  return TITLES[pathname] ?? "Useful Brain";
}
