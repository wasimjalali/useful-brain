"use client";

import { useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query. The server snapshot is `false`, so the
 * desktop-first branch renders on the server and the client corrects it right
 * after hydration. Without `matchMedia` (older test runners) it stays `false`.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      if (typeof window === "undefined" || !window.matchMedia) {
        return () => {};
      }
      const list = window.matchMedia(query);
      list.addEventListener("change", callback);
      return () => list.removeEventListener("change", callback);
    },
    () =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(query).matches
        : false,
    () => false,
  );
}
