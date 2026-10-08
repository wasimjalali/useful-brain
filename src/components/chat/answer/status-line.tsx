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

/** Shows the latest label, but keeps each one on screen for at least `minMs`. */
function useHeldLabel(label: string, minMs: number): string {
  const [shown, setShown] = useState(label);
  const shownAt = useRef<number | null>(null);
  const current = useRef(shown);

  useEffect(() => {
    shownAt.current ??= Date.now();
    if (label === current.current) {
      return;
    }
    const wait = Math.max(0, minMs - (Date.now() - shownAt.current));
    const timer = setTimeout(() => {
      current.current = label;
      shownAt.current = Date.now();
      setShown(label);
    }, wait);
    return () => clearTimeout(timer);
  }, [label, minMs]);

  return shown;
}

export function StatusLine({ progress }: { progress: ChatProgressView }) {
  const label = useHeldLabel(progressLabel(progress), MIN_DWELL_MS);
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
