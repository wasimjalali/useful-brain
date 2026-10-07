"use client";

import { useEffect, useRef } from "react";

/** Scrolls the element into view each time `active` turns on. Honours reduced motion. */
export function useScrollWhenActive<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) {
      return;
    }
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [active]);
  return ref;
}
