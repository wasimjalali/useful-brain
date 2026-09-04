"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowRightIcon, CloseIcon, SourceIcon } from "@/components/icons";
import { Dialog } from "@/components/ui/dialog";
import { formatRetrievalScore } from "@/lib/rag/retrieval";

export type EvidenceTab = "cited" | "retrieved";

export type EvidenceItem = {
  id: string;
  label: string;
  labelNumber: string;
  source: string;
  section: string;
  text: string;
  score: number;
  scoreLabel: string;
  rankLabel: string;
  tokenEstimate: number;
  generationId?: string;
  vectorScore?: number | null;
  keywordScore?: number | null;
  fusedScore?: number | null;
  rerankScore?: number | null;
};

export function normalizeForEvidenceMatch(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

type EvidenceInspectorProps = {
  citedItems: EvidenceItem[];
  focusId: string | null;
  focusText?: string | null;
  focusToken?: number;
  onClose: () => void;
  onOpenChunk: (item: EvidenceItem) => void;
  retrievedItems: EvidenceItem[];
};

export function EvidenceInspector({
  citedItems,
  focusId,
  focusText = null,
  focusToken = 0,
  onClose,
  onOpenChunk,
  retrievedItems,
}: EvidenceInspectorProps) {
  return (
    <EvidenceInspectorPanel
      citedItems={citedItems}
      focusId={focusId}
      focusText={focusText}
      focusToken={focusToken}
      key={focusToken}
      onClose={onClose}
      onOpenChunk={onOpenChunk}
      retrievedItems={retrievedItems}
    />
  );
}

function EvidenceInspectorPanel({
  citedItems,
  focusId,
  focusText,
  focusToken,
  onClose,
  onOpenChunk,
  retrievedItems,
}: EvidenceInspectorProps) {
  const [activeTab, setActiveTab] = useState<EvidenceTab>(() =>
    focusId && !citedItems.some((item) => item.id === focusId)
      ? "retrieved"
      : "cited",
  );
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const closeRef = useRef<HTMLButtonElement>(null);
  const activeItems = activeTab === "cited" ? citedItems : retrievedItems;

  useEffect(() => {
    const isOverlay =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 1023px)").matches;
    if (!isOverlay) {
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      if (previous?.isConnected) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    if (!focusId || focusToken === 0) {
      return;
    }

    const start = setTimeout(() => {
      const card = cardRefs.current.get(focusId);
      if (!card) {
        return;
      }
      card.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
      card.removeAttribute("data-flash");
      void card.offsetWidth;
      card.setAttribute("data-flash", "true");
    }, 130);
    const end = setTimeout(() => {
      cardRefs.current.get(focusId)?.removeAttribute("data-flash");
    }, 1130);
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
  }, [focusId, focusToken]);

  return (
    <aside
      aria-label="Evidence"
      className="panel-in fixed inset-y-0 right-0 z-40 flex w-[86%] max-w-[360px] flex-col border-l border-border bg-surface shadow-pop lg:static lg:z-auto lg:my-0 lg:w-[360px] lg:overflow-hidden lg:rounded-[24px] lg:shadow-none"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
        <div>
          <p className="text-sm font-semibold text-ink">Evidence</p>
          <p className="text-xs text-ink-muted">
            {citedItems.length} cited of {retrievedItems.length} retrieved
          </p>
        </div>
        <button
          aria-label="Close evidence"
          className="icon-btn size-10"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          <CloseIcon className="size-5" />
        </button>
      </div>

      <div aria-label="Evidence tabs" className="flex border-b border-border px-3" role="tablist">
        <EvidenceTabButton
          active={activeTab === "cited"}
          label={`Cited ${citedItems.length}`}
          onClick={() => setActiveTab("cited")}
        />
        <EvidenceTabButton
          active={activeTab === "retrieved"}
          label={`Retrieved ${retrievedItems.length}`}
          onClick={() => setActiveTab("retrieved")}
        />
      </div>

      {activeItems.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <span className="grid size-10 place-items-center rounded-xl bg-sunken text-ink-faint">
            <SourceIcon className="size-5" />
          </span>
          <p className="text-sm font-medium text-ink">No {activeTab} evidence</p>
          <p className="text-xs leading-5 text-ink-faint">
            Cited chunks stay separate from the wider retrieval set.
          </p>
        </div>
      ) : (
        <div className="uv-scroll flex-1 overflow-y-auto px-4 py-4" role="tabpanel">
          <div className="flex flex-col gap-2.5">
            {activeItems.map((item) => (
              <button
                aria-label={`View full chunk: ${item.source}, ${item.section}`}
                className="evidence-card w-full p-3.5 text-left"
                data-active={item.id === focusId ? "true" : undefined}
                key={item.id}
                onClick={() => onOpenChunk(item)}
                ref={(node) => {
                  if (node) {
                    cardRefs.current.set(item.id, node);
                  } else {
                    cardRefs.current.delete(item.id);
                  }
                }}
                type="button"
              >
                <EvidenceCardBody item={item} />
                <span className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-accent-deep">
                  View full chunk
                  <ArrowRightIcon className="size-3.5" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {focusText ? <span className="sr-only">Evidence focus updated</span> : null}
    </aside>
  );
}

function EvidenceTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className="evidence-tab min-h-10 px-3 text-sm font-medium"
      onClick={onClick}
      role="tab"
      type="button"
    >
      {label}
    </button>
  );
}

function EvidenceCardBody({ item }: { item: EvidenceItem }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-accent-deep">
          <span className="grid size-5 place-items-center rounded-md bg-accent-soft">
            {item.labelNumber}
          </span>
          {item.rankLabel}
        </span>
        <span className="tnum font-mono text-xs text-ink-muted">{item.scoreLabel}</span>
      </div>
      <p className="mt-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <SourceIcon className="size-3.5 shrink-0 text-ink-faint" />
        {item.source}
      </p>
      <p className="mt-0.5 text-xs text-ink-muted">{item.section}</p>
      <p className="mt-2 line-clamp-3 text-xs leading-5 text-ink-muted">{item.text}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2.5 font-mono text-[10px] text-ink-faint">
        <EvidenceMetric label="Keyword" value={item.keywordScore} />
        <EvidenceMetric label="Vector" value={item.vectorScore} />
        <EvidenceMetric label="Fused" value={item.fusedScore} />
        <EvidenceMetric label="Rerank" value={item.rerankScore} />
      </dl>
    </>
  );
}

export function EvidenceChunkDialog({
  focusText = null,
  item,
  onClose,
}: {
  focusText?: string | null;
  item: EvidenceItem;
  onClose: () => void;
}) {
  const match = findEvidenceSentenceMatch(item.text, focusText);

  return (
    <Dialog
      ariaLabel={`Source ${item.labelNumber}: ${item.source}`}
      maxWidth="max-w-2xl"
      onClose={onClose}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-accent-soft font-mono text-xs font-semibold text-accent-deep">
              {item.labelNumber}
            </span>
            <h2 className="truncate text-base font-semibold text-ink">{item.source}</h2>
          </div>
          <p className="mt-1 text-xs text-ink-muted">{item.section}</p>
        </div>
        <button
          aria-label="Close"
          className="icon-btn size-10 shrink-0"
          onClick={onClose}
          type="button"
        >
          <CloseIcon className="size-5" />
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-b border-border px-5 py-4 sm:grid-cols-3">
        <StatCell label="Rank" value={item.rankLabel.replace("Rank ", "#")} />
        <StatCell label="Keyword" value={formatEvidenceScore(item.keywordScore)} />
        <StatCell label="Vector" value={formatEvidenceScore(item.vectorScore)} />
        <StatCell label="Fused" value={formatEvidenceScore(item.fusedScore)} />
        <StatCell label="Rerank" value={formatEvidenceScore(item.rerankScore)} />
        <StatCell label="Tokens" value={`~${item.tokenEstimate}`} />
      </dl>

      <div className="uv-scroll max-h-[50vh] overflow-y-auto px-5 py-4">
        <p className="mb-1 font-mono text-xs text-ink-faint">
          Generation {item.generationId ?? "Unavailable"}
        </p>
        <p className="mb-2 font-mono text-xs text-ink-faint">{item.id}</p>
        {match ? (
          <p className="whitespace-pre-wrap text-sm leading-7 text-ink">
            {match.before}
            <mark className="evidence-sentence">{match.value}</mark>
            {match.after}
          </p>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-7 text-ink">{item.text}</p>
        )}
      </div>
    </Dialog>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-ink-faint">{label}</dt>
      <dd className="tnum mt-1 truncate text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function EvidenceMetric({
  label,
  value,
}: {
  label: string;
  value?: number | null;
}) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{label}</dt>
      <dd className="tnum text-ink-muted">{formatEvidenceScore(value)}</dd>
    </div>
  );
}

function formatEvidenceScore(value?: number | null) {
  return value === null || value === undefined
    ? "Unavailable"
    : formatRetrievalScore(value);
}

function findEvidenceSentenceMatch(text: string, focusText: string | null) {
  const normalizedFocus = normalizeForEvidenceMatch(focusText ?? "");
  if (!normalizedFocus) {
    return null;
  }

  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const value = sentences.find((sentence) =>
    normalizeForEvidenceMatch(sentence).includes(normalizedFocus),
  );
  if (!value) {
    return null;
  }

  const start = text.indexOf(value);
  return {
    before: text.slice(0, start),
    value,
    after: text.slice(start + value.length),
  };
}
