"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus trap for a slide-over or sheet: moves focus in, keeps Tab inside,
 * closes on Escape and gives focus back to whatever had it before.
 */
export function useModalLayer(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active) {
      return;
    }
    const container = containerRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const first = container?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? container)?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // A dialog stacked above this layer owns Escape.
        const stacked = Array.from(
          document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
        ).some((dialog) => dialog !== container);
        if (stacked) {
          return;
        }
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !container) {
        return;
      }
      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
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
      if (previous?.isConnected) {
        previous.focus();
      }
    };
  }, [active, containerRef]);
}
