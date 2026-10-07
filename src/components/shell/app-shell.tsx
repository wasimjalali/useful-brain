"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import type { WorkspaceIdentity } from "@/app/actions";
import { MenuIcon, SquarePenIcon } from "@/components/icons";
import { SearchHost } from "@/components/search/search-host";
import { IconButton } from "@/components/ui/button";
import { useMediaQuery } from "@/lib/use-media-query";
import type { ActionResult } from "@/lib/rag/app-errors";
import type { EmbeddingStorageStatus } from "@/lib/rag/storage-records";
import type { KnowledgeInventory } from "@/lib/store/knowledge-inventory";

import { conversationIdFromPath, routeFamily, titleForPath } from "./nav";
import { Rail } from "./rail";
import { SettingsHost } from "./settings-host";
import {
  ShellContext,
  type ConversationSummary,
  type PanelRegistration,
  type ShellContextValue,
} from "./shell-context";
import { GlobalShortcuts } from "./shortcuts";
import { useModalLayer } from "./use-modal-layer";

import "./shell.css";

export type AppShellProps = {
  children: ReactNode;
  deleteConversationAction: (conversationId: string) => Promise<ActionResult<null>>;
  embeddingStorageStatus: EmbeddingStorageStatus;
  identity: WorkspaceIdentity | null;
  initialConversations: ConversationSummary[];
  retrievalMode: KnowledgeInventory["retrievalMode"];
  retrievalReady: boolean;
};

export function AppShell({
  children,
  deleteConversationAction,
  identity,
  initialConversations,
  retrievalReady,
}: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [conversations, setConversations] = useState(initialConversations);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [newChatNonce, setNewChatNonce] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [now] = useState(() => Date.now());

  // Breakpoints: >=1200 rail + stage + side panel, 768-1199 slide-over rail
  // and right sheet, <768 mobile with a bottom sheet. Desktop is the default
  // until the client reads the real viewport.
  const overlayRail = useMediaQuery("(max-width: 1199px)");
  const mobile = useMediaQuery("(max-width: 767px)");
  const panelMode = mobile ? "bottom" : overlayRail ? "right" : "side";

  // The slide-over is open only on the page it was opened on, so any
  // navigation closes it without an effect.
  const [railOpenPath, setRailOpenPath] = useState<string | null>(null);
  const railOpen = overlayRail && railOpenPath === pathname;
  const closeRail = useCallback(() => setRailOpenPath(null), []);
  const railRef = useRef<HTMLElement>(null);
  useModalLayer(railOpen, railRef, closeRail);

  const [panel, setPanel] = useState<PanelRegistration | null>(null);
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetActive = panel !== null && panelMode !== "side" && panelHost !== null;
  useModalLayer(sheetActive, sheetRef, () => panel?.onClose());

  useEffect(() => {
    if (!panel || panelMode !== "side") {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        return;
      }
      panel?.onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, panelMode]);

  const newChat = useCallback(() => setNewChatNonce((value) => value + 1), []);
  const openSearch = useCallback(() => setSearchOpen(true), []);

  const withSettings = useCallback(
    (open: boolean) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (open) {
        params.set("settings", "1");
      } else {
        params.delete("settings");
      }
      const query = params.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, searchParams],
  );
  const settingsOpen = searchParams?.get("settings") === "1";
  const openSettings = useCallback(
    () => router.push(withSettings(true)),
    [router, withSettings],
  );
  const closeSettings = useCallback(
    () => router.replace(withSettings(false)),
    [router, withSettings],
  );

  const upsertConversation = useCallback((id: string, title: string) => {
    setConversations((current) => {
      const existing = current.find((conversation) => conversation.id === id);
      const stamp = Date.now();
      return [
        {
          id,
          title: existing?.title ?? title,
          createdAt: existing?.createdAt ?? stamp,
          updatedAt: stamp,
        },
        ...current.filter((conversation) => conversation.id !== id),
      ];
    });
  }, []);

  const removeConversation = useCallback(
    async (id: string) => {
      setConversationError(null);
      const result = await deleteConversationAction(id);
      if (!result.ok) {
        setConversationError(result.error.message);
        return result.error.message;
      }
      setConversations((current) => current.filter((conversation) => conversation.id !== id));
      if (conversationIdFromPath(pathname) === id) {
        newChat();
        router.push("/chat");
      }
      return null;
    },
    [deleteConversationAction, newChat, pathname, router],
  );

  const registerPanel = useCallback(
    (registration: PanelRegistration | null) => setPanel(registration),
    [],
  );

  const context = useMemo<ShellContextValue>(
    () => ({
      identity,
      conversations,
      retrievalReady,
      upsertConversation,
      removeConversation,
      conversationError,
      newChatNonce,
      newChat,
      openSearch,
      openSettings,
      panelHost,
      registerPanel,
    }),
    [
      conversationError,
      conversations,
      identity,
      newChat,
      newChatNonce,
      openSearch,
      openSettings,
      panelHost,
      registerPanel,
      removeConversation,
      retrievalReady,
      upsertConversation,
    ],
  );

  // Page change is two beats: the old page fades out on the click, the new
  // one rises in once the route family changes.
  const family = routeFamily(pathname);
  const [leavingFrom, setLeavingFrom] = useState<string | null>(null);
  useEffect(() => {
    if (!leavingFrom) {
      return;
    }
    const timer = setTimeout(() => setLeavingFrom(null), 700);
    return () => clearTimeout(timer);
  }, [leavingFrom]);
  function onShellClick(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-nav]");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    const href = link.getAttribute("href") ?? "";
    if (routeFamily(href.split("?")[0]) !== family) {
      setLeavingFrom(family);
    }
  }

  const title = titleForPath(pathname, conversations);

  return (
    <ShellContext.Provider value={context}>
      <div className="ub-shell" onClick={onShellClick}>
        <Rail
          conversationError={conversationError}
          conversations={conversations}
          identity={identity}
          modal={railOpen}
          now={now}
          onClose={closeRail}
          onDeleteConversation={(id) => void removeConversation(id)}
          onNavigate={closeRail}
          onNewChat={newChat}
          onSearch={openSearch}
          onSettings={openSettings}
          overlay={overlayRail}
          pathname={pathname}
          railRef={railRef}
        />
        {railOpen ? (
          <button
            aria-label="Close navigation"
            className="ub-scrim"
            onClick={closeRail}
            type="button"
          />
        ) : null}
        <div className="ub-main" data-rail-open={railOpen ? "true" : undefined}>
          <main className="ub-stage">
            <header className="ub-header">
              <IconButton
                aria-controls="app-rail"
                aria-expanded={railOpen}
                aria-label="Open navigation"
                onClick={() => setRailOpenPath(pathname)}
              >
                <MenuIcon className="size-5" />
              </IconButton>
              <span className="ub-header-title">{title}</span>
              <Link
                aria-label="New chat"
                className="ub-iconbtn ub-ring"
                data-nav="true"
                href="/chat"
                onClick={newChat}
              >
                <SquarePenIcon className="size-5" />
              </Link>
            </header>
            <div
              className="ub-page"
              data-leaving={leavingFrom === family ? "true" : undefined}
              key={family}
            >
              {children}
            </div>
          </main>
          {panel && panelMode === "side" ? (
            <div className="ub-panel">
              <div className="ub-panel-body" ref={setPanelHost} />
            </div>
          ) : null}
        </div>

        {panel && panelMode !== "side" ? (
          <>
            <button
              aria-label="Close sheet"
              className="ub-scrim"
              onClick={panel.onClose}
              type="button"
            />
            <div
              aria-label={panel.label}
              aria-modal="true"
              className={panelMode === "bottom" ? "ub-sheet-bottom" : "ub-sheet-right"}
              ref={sheetRef}
              role="dialog"
              tabIndex={-1}
            >
              {panelMode === "bottom" ? (
                <span aria-hidden="true" className="ub-grabber" />
              ) : null}
              <div className="ub-panel-body" ref={setPanelHost} />
            </div>
          </>
        ) : null}
      </div>

      <GlobalShortcuts
        onNewChat={() => {
          newChat();
          router.push("/chat");
        }}
        onSearch={openSearch}
      />

      {searchOpen ? (
        <SearchHost onClose={() => setSearchOpen(false)} />
      ) : null}
      {settingsOpen ? (
        <SettingsHost identity={identity} onClose={closeSettings} />
      ) : null}
    </ShellContext.Provider>
  );
}
