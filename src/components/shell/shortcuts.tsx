"use client";

import { useEffect, useRef } from "react";

import { detectMac } from "./platform";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  // The composer is the one text field that still lets the shortcuts through.
  if (target.dataset.composer === "true") {
    return false;
  }
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/** ⌘N starts a new chat, ⌘K opens search. Ctrl replaces ⌘ off the Mac. */
export function GlobalShortcuts({
  onNewChat,
  onSearch,
}: {
  onNewChat: () => void;
  onSearch: () => void;
}) {
  const handlers = useRef({ onNewChat, onSearch });
  useEffect(() => {
    handlers.current = { onNewChat, onSearch };
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.shiftKey) {
        return;
      }
      const mac = detectMac();
      const modifier = mac
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (!modifier) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== "n" && key !== "k") {
        return;
      }
      if (isEditable(event.target)) {
        return;
      }
      // A dialog or slide-over owns the keyboard while it is open.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        return;
      }
      event.preventDefault();
      if (key === "n") {
        handlers.current.onNewChat();
      } else {
        handlers.current.onSearch();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
