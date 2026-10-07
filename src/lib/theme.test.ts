import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyTheme,
  readTheme,
  resolveTheme,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  useTheme,
  writeTheme,
} from "./theme";

type Listener = (event: { matches: boolean }) => void;

function mockMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  let matches = initial;
  window.matchMedia = vi.fn().mockImplementation(() => ({
    get matches() {
      return matches;
    },
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  })) as unknown as typeof window.matchMedia;
  return (next: boolean) => {
    matches = next;
    listeners.forEach((l) => l({ matches: next }));
  };
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(() => vi.restoreAllMocks());

describe("theme storage", () => {
  it("defaults to system and ignores junk values", () => {
    expect(readTheme()).toBe("system");
    window.localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(readTheme()).toBe("system");
  });

  it("falls back to system when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readTheme()).toBe("system");
  });

  it("still applies the choice when storage write throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    writeTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("applyTheme sets light and dark, removes the attribute for system", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe("resolveTheme", () => {
  it("system follows the OS, explicit choices win", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("pre-paint script", () => {
  it("sets data-theme for stored light or dark and nothing for system", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe("dark");
    delete document.documentElement.dataset.theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe("useTheme", () => {
  it("tracks live OS changes while on system", () => {
    const setSystem = mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe("light");
    act(() => setSystem(true));
    expect(result.current.resolved).toBe("dark");
  });

  it("setChoice persists, applies and overrides the OS", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setChoice("light"));
    expect(result.current.choice).toBe("light");
    expect(result.current.resolved).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows storage events from another tab", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
    });
    expect(result.current.choice).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
