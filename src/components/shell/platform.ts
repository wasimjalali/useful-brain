"use client";

import { useSyncExternalStore } from "react";

export function detectMac(): boolean {
  if (typeof navigator === "undefined") {
    return true;
  }
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ||
    navigator.platform ||
    "";
  return /mac|iphone|ipad/i.test(platform);
}

const noopSubscribe = () => () => {};

/** Mac renders and listens for ⌘. Everything else uses Ctrl. */
export function useIsMac(): boolean {
  return useSyncExternalStore(noopSubscribe, detectMac, () => true);
}

export function shortcutLabel(isMac: boolean, key: string): string {
  return isMac ? `⌘${key}` : `Ctrl ${key}`;
}
