"use client";

import { useTheme } from "@/lib/theme";

/** Subscribes once at the root so every page follows storage and OS theme changes. */
export function ThemeSync() {
  useTheme();
  return null;
}
