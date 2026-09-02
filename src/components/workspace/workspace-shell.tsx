"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { UsefulBrainLogo } from "@/components/useful-brain-logo";
import { DEFAULT_USEFUL_BRAIN_CONFIG } from "@/lib/useful-brain-config";

export type WorkspaceView = "chat" | "knowledge" | "evaluations" | "settings";

export type WorkspaceShellProps = {
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  navigation: ReactNode;
  inspector?: ReactNode;
  children: ReactNode;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type WorkspaceNavigationProps = {
  mobile?: boolean;
  onSelectConversation?: (id: string) => void;
  onSelectView?: (view: WorkspaceView) => void;
};

export function WorkspaceShell({
  activeView,
  children,
  inspector,
  navigation,
  onSelectView,
}: WorkspaceShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  function selectView(view: WorkspaceView) {
    onSelectView(view);
    setMobileNavOpen(false);
  }

  function selectConversation(id: string) {
    if (isValidElement<WorkspaceNavigationProps>(navigation)) {
      navigation.props.onSelectConversation?.(id);
    }
    setMobileNavOpen(false);
  }

  return (
    <div
      className="flex h-screen w-full overflow-hidden bg-canvas text-ink"
      data-active-view={activeView}
    >
      {navigation}

      {mobileNavOpen ? (
        <MobileNavOverlay onClose={closeMobileNav}>
          {isValidElement<WorkspaceNavigationProps>(navigation)
            ? cloneElement(navigation, {
                mobile: true,
                onSelectConversation: selectConversation,
                onSelectView: selectView,
              })
            : navigation}
        </MobileNavOverlay>
      ) : null}

      <div className="flex min-w-0 flex-1 p-2.5 lg:pl-0">
        <main className="stage flex min-w-0 flex-1 flex-col">
          <MobileTopBar onOpenNav={() => setMobileNavOpen(true)} />
          {children}
        </main>
        {inspector}
      </div>
    </div>
  );
}

function MobileTopBar({ onOpenNav }: { onOpenNav: () => void }) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5 lg:hidden">
      <button
        aria-label="Open navigation"
        className="icon-btn size-9"
        onClick={onOpenNav}
        type="button"
      >
        <MenuGlyph />
      </button>
      <UsefulBrainLogo compact />
      <span className="text-sm font-semibold text-ink">
        {DEFAULT_USEFUL_BRAIN_CONFIG.productName}
      </span>
    </header>
  );
}

function MobileNavOverlay({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) {
        return;
      }
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button
        aria-label="Close navigation"
        className="absolute inset-0 bg-ink/30"
        onClick={onClose}
        type="button"
      />
      <div
        aria-label="Navigation"
        aria-modal="true"
        className="panel-in absolute inset-y-0 left-0 w-[264px]"
        ref={panelRef}
        role="dialog"
      >
        {children}
      </div>
    </div>
  );
}

function MenuGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
