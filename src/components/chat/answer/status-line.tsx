"use client";

import { useEffect, useRef, useState } from "react";

import type { ChatProgressView } from "@/lib/contracts/chat-view";

import { plural } from "./format";

const MIN_DWELL_MS = 260;

export function progressLabel(progress: ChatProgressView): string {
  switch (progress.kind) {
    case "searching":
      return `Searching ${plural(progress.readableDocuments, "document", "documents")}`;
    case "reading":
      return `Reading ${plural(progress.passages, "passage", "passages")}`;
    case "writing":
      return "Writing a cited answer";
  }
}

/**
 * Walks the given labels in order, keeping each on screen for at least
 * `minMs`. A label already shown (or past) is not repeated.
 */
function useHeldLabel(steps: string[], minMs: number): string {
  const [shown, setShown] = useState(steps[0]);
  const shownAt = useRef<number | null>(null);
  const key = steps.join("\n");

  useEffect(() => {
    shownAt.current ??= Date.now();
    const list = key.split("\n");
    const index = list.indexOf(shown);
    if (index === list.length - 1) {
      return;
    }
    const next = list[index + 1];
    const wait = Math.max(0, minMs - (Date.now() - shownAt.current));
    const timer = setTimeout(() => {
      shownAt.current = Date.now();
      setShown(next);
    }, wait);
    return () => clearTimeout(timer);
  }, [key, minMs, shown]);

  return shown;
}

export function StatusLine({ progress }: { progress: ChatProgressView }) {
  // The reading stage can be shorter than a poll; when writing reports the
  // passages it read, show that stage first.
  const steps =
    progress.kind === "writing" && progress.passages !== undefined
      ? [progressLabel({ kind: "reading", passages: progress.passages }), progressLabel(progress)]
      : [progressLabel(progress)];
  const label = useHeldLabel(steps, MIN_DWELL_MS);
  return (
    <div
      aria-live="polite"
      className="flex items-center gap-2.5 py-1 text-[15px] leading-6 text-ink-muted"
      role="status"
    >
      <span aria-hidden="true" className="pulse-dot size-1.5 shrink-0 rounded-full bg-ink" />
      <span className="status-rise" key={label}>
        {label}
      </span>
    </div>
  );
}
