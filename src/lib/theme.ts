"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export { THEME_STORAGE_KEY } from "./theme-key";
import { THEME_STORAGE_KEY } from "./theme-key";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function isChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

export function readTheme(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isChoice(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function writeTheme(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage can be blocked. The choice still applies for this page view.
  }
  applyTheme(choice);
}

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  if (choice === "system") {
    return systemDark ? "dark" : "light";
  }
  return choice;
}

/** Light and dark set data-theme on the root. System removes it so the media query decides. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = choice;
  }
}

const CHOICE_EVENT = "useful-brain:theme";

function subscribeChoice(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      applyTheme(readTheme());
      notify();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHOICE_EVENT, notify);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHOICE_EVENT, notify);
  };
}

function subscribeSystem(notify: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

export function useTheme(): {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
} {
  const choice = useSyncExternalStore<ThemeChoice>(subscribeChoice, readTheme, () => "system");
  const systemDark = useSyncExternalStore(subscribeSystem, systemPrefersDark, () => false);

  const setChoice = useCallback((next: ThemeChoice) => {
    writeTheme(next);
    window.dispatchEvent(new Event(CHOICE_EVENT));
  }, []);

  return { choice, resolved: resolveTheme(choice, systemDark), setChoice };
}
