"use client";

import type { SourceRefView } from "@/lib/contracts/chat-view";

import { useCitationBinding } from "../evidence/citation-link";

function SourceButton({ source }: { source: SourceRefView }) {
  const { active, onHover, onClick } = useCitationBinding(source.n);
  return (
    <button
      aria-label={`Source ${source.n}: ${source.document}, ${source.section}`}
      className="ub-ring inline-flex h-8 max-w-full items-center gap-2 whitespace-nowrap rounded-[10px] bg-sunken px-2.5 shadow-[inset_0_0_0_1px_var(--edge)]"
      data-active={active ? "true" : undefined}
      data-opens-evidence="true"
      onBlur={() => onHover(false)}
      onClick={onClick}
      onFocus={() => onHover(true)}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-md px-[5px] font-mono text-[11px] font-medium leading-none transition-colors duration-[160ms] ${
          active ? "bg-accent text-accent-ink" : "bg-bubble text-ink-muted"
        }`}
      >
        {source.n}
      </span>
      <span className="truncate text-[13px] font-medium text-ink">{source.document}</span>
      <span className="truncate text-xs text-ink-faint-text">{source.section}</span>
    </button>
  );
}

export function SourcesRow({ sources }: { sources: SourceRefView[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((source) => (
        <SourceButton key={source.n} source={source} />
      ))}
    </div>
  );
}
