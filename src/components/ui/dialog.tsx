"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  ariaLabel,
  children,
  maxWidth,
  onClose,
  top,
  width,
}: {
  ariaLabel: string;
  children: ReactNode;
  /** Legacy Tailwind max-width class, e.g. "max-w-2xl". Prefer `width`. */
  maxWidth?: string;
  onClose: () => void;
  /** Distance from the top of the viewport in px. Omit to centre vertically. */
  top?: number;
  /** Panel width in px. Shrinks to fit narrow viewports. */
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) {
        return;
      }
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
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
  }, []);

  if (typeof document === "undefined") {
    return null;
  }

  const panelStyle: CSSProperties | undefined = width
    ? { width, maxWidth: "100%" }
    : undefined;

  return createPortal(
    <div
      className="dialog-overlay"
      data-top={top === undefined ? undefined : "true"}
      onClick={() => onCloseRef.current()}
      style={top === undefined ? undefined : { paddingTop: top }}
    >
      <div
        aria-label={ariaLabel}
        aria-modal="true"
        className={`dialog-panel ${maxWidth ?? ""}`.trim()}
        onClick={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
        style={panelStyle}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
