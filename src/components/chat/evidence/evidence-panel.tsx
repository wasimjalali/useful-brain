"use client";

import { useEffect, useState } from "react";

import { ArrowRightIcon, CheckIcon, ChevronRightIcon, CopyIcon, XIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { PassageSkeleton } from "@/components/ui/skeleton";
import type {
  CitedPassageView,
  EvidenceTab,
  HighlightRange,
  RetrievedPassageView,
} from "@/lib/contracts/chat-view";
import { Highlight } from "@/components/ui/highlight";
import { CitationChip } from "@/components/ui/citation-chip";

import { shortGenerationId } from "@/lib/labels";
import { useCitationBinding } from "./citation-link";
import { useScrollWhenActive } from "./use-scroll-when-active";

function score(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : value.toFixed(3);
}

function PassageText({ text, highlights, active }: { text: string; highlights?: HighlightRange[]; active: boolean }) {
  const ranges = [...(highlights ?? [])]
    .filter((r) => r.end > r.start && r.start >= 0 && r.start < text.length)
    .sort((a, b) => a.start - b.start);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    const start = Math.max(range.start, cursor);
    const end = Math.min(range.end, text.length);
    if (end <= start) {
      return;
    }
    if (start > cursor) {
      nodes.push(text.slice(cursor, start));
    }
    nodes.push(
      <Highlight active={active} key={index}>
        {text.slice(start, end)}
      </Highlight>,
    );
    cursor = end;
  });
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return (
    <p className="m-0 ml-[26px] text-[13px] leading-[21px] text-ink-muted [text-wrap:pretty]">{nodes}</p>
  );
}

const DETAILS_KEY = "ub:retrieval-details-open";

function CopyChunkButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      aria-label="Copy chunk ID"
      className="ub-ring inline-flex items-center gap-1 rounded p-0.5 text-ink-faint-text transition-colors duration-[120ms] hover:bg-hover hover:text-ink"
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
      type="button"
    >
      {copied ? <span className="text-[11px]">Copied</span> : null}
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </button>
  );
}

function RetrievalDetails({ passage }: { passage: CitedPassageView }) {
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(DETAILS_KEY) === "1";
    } catch {
      // Storage can be blocked. The disclosure then starts closed.
      return false;
    }
  });
  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(DETAILS_KEY, next ? "1" : "0");
    } catch {
      // Not remembering is fine.
    }
  }
  const scores = [
    ["Keyword", passage.keywordScore],
    ["Vector", passage.vectorScore],
    ["Rerank", passage.rerankScore],
  ] as const;
  return (
    <div className="ml-[26px] rounded-[10px] bg-sunken">
      <button
        aria-expanded={open}
        className="ub-ring flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-xs text-ink-muted"
        onClick={toggle}
        type="button"
      >
        Retrieval details
        <ChevronRightIcon
          aria-hidden="true"
          className={`size-3.5 transition-transform duration-[160ms] ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-2 px-2.5 pb-2.5">
          <div className="grid grid-cols-3 rounded-lg bg-surface shadow-[0_0_0_1px_var(--edge)]">
            {scores.map(([label, value]) => (
              <div className="flex flex-col gap-px border-l border-border px-[9px] py-[7px] first:border-l-0" key={label}>
                <span className="text-[10.5px] text-ink-faint-text">{label}</span>
                <span className="font-mono text-[13px] tabular-nums text-ink">{score(value)}</span>
              </div>
            ))}
          </div>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-faint-text">
            <dt>Chunk</dt>
            <dd className="m-0 truncate font-mono text-ink-muted" title={passage.chunkId}>
              {passage.chunkId}
            </dd>
            <CopyChunkButton value={passage.chunkId} />
            {passage.generation ? (
              <>
                <dt>Generation</dt>
                <dd className="m-0 truncate font-mono text-ink-muted" title={passage.generation}>
                  {shortGenerationId(passage.generation)}
                </dd>
                <span />
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function CitedRow({
  passage,
  isAdmin,
  onOpenDocument,
}: {
  passage: CitedPassageView;
  isAdmin: boolean;
  onOpenDocument: (n: number) => void;
}) {
  const { active, onHover, onClick } = useCitationBinding(passage.n);
  const ref = useScrollWhenActive<HTMLDivElement>(active);
  return (
    <div
      className="flex flex-col gap-2.5 px-5 py-5 first:pt-4"
      data-active={active ? "true" : undefined}
      data-passage={passage.n}
      ref={ref}
    >
      <div className="flex items-center gap-2">
        <CitationChip active={active} n={passage.display ?? passage.n} onClick={onClick} onHover={onHover} />
        <span className="truncate text-[13px] font-medium text-ink">{passage.document}</span>
        <span className="truncate text-xs text-ink-faint-text">{passage.section}</span>
      </div>
      <PassageText active={active} highlights={passage.highlights} text={passage.text} />
      <button
        className="ub-ring ml-[26px] inline-flex w-max items-center gap-1 rounded-md text-xs font-medium text-ink-muted transition-colors duration-[120ms] hover:text-ink"
        onClick={() => onOpenDocument(passage.n)}
        type="button"
      >
        Open document
        <ArrowRightIcon className="size-3.5" />
      </button>
      {isAdmin ? <RetrievalDetails passage={passage} /> : null}
    </div>
  );
}

function RetrievedRow({ row, isAdmin }: { row: RetrievedPassageView; isAdmin: boolean }) {
  return (
    <div className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-x-2.5 px-5 py-2.5 transition-colors duration-[120ms] hover:bg-sunken">
      <span className="font-mono text-[11px] leading-[18px] text-ink-faint-text">{row.rank}</span>
      <div className="flex min-w-0 flex-col gap-px">
        <span className="truncate text-[13px] font-medium leading-[18px] text-ink">{row.document}</span>
        <span className="truncate text-xs leading-4 text-ink-faint-text">{row.section}</span>
      </div>
      <div className="flex h-[18px] items-center gap-2">
        {row.cited ? <span className="text-xs text-ink-muted">Cited</span> : null}
        {isAdmin ? <span className="font-mono text-[11px] text-ink-muted">{score(row.rerankScore)}</span> : null}
      </div>
    </div>
  );
}

export function EvidencePanel({
  cited,
  retrieved,
  tab,
  onTabChange,
  isAdmin,
  generation,
  rerankFloor,
  loading = false,
  onClose,
  onOpenDocument,
}: {
  cited: CitedPassageView[];
  retrieved: RetrievedPassageView[];
  tab: EvidenceTab;
  onTabChange: (tab: EvidenceTab) => void;
  isAdmin: boolean;
  generation?: string;
  rerankFloor?: number;
  loading?: boolean;
  onClose: () => void;
  /** Receives the citation number of the passage whose document should open. */
  onOpenDocument: (n: number) => void;
}) {
  return (
    <aside
      aria-label="Evidence"
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface"
    >
      <div className="flex h-[52px] shrink-0 items-center justify-between pl-5 pr-3">
        <h2 className="m-0 text-sm font-semibold text-ink">Evidence</h2>
        <IconButton aria-label="Close evidence" onClick={onClose}>
          <XIcon className="size-4" />
        </IconButton>
      </div>
      <div className="px-5 pb-2">
        <Segmented
          label="Evidence view"
          mode="tablist"
          onChange={(value) => onTabChange(value as EvidenceTab)}
          options={[
            { value: "cited", label: "Cited", count: cited.length },
            { value: "retrieved", label: "Retrieved", count: retrieved.length },
          ]}
          value={tab}
        />
      </div>
      <div
        aria-label={tab === "cited" ? "Cited passages" : "Retrieved passages"}
        className="min-h-0 flex-1 overflow-y-auto"
        role="tabpanel"
      >
        {tab === "cited" ? (
          loading ? (
            <div className="flex flex-col gap-6 px-5 py-4">
              <PassageSkeleton />
              <PassageSkeleton />
            </div>
          ) : (
            cited.map((passage, index) => (
              <div className={index > 0 ? "mx-5 border-t border-border" : undefined} key={passage.n}>
                <div className={index > 0 ? "-mx-5" : undefined}>
                  <CitedRow isAdmin={isAdmin} onOpenDocument={onOpenDocument} passage={passage} />
                </div>
              </div>
            ))
          )
        ) : (
          <div className="py-2">
            {retrieved.map((row) => (
              <RetrievedRow isAdmin={isAdmin} key={row.chunkId} row={row} />
            ))}
            {isAdmin && generation ? (
              <div className="mx-5 mt-2.5 border-t border-border pt-3 font-mono text-[11px] leading-[17px] text-ink-faint-text">
                Rerank score · floor {rerankFloor ?? "n/a"} · <span title={generation}>{shortGenerationId(generation)}</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
