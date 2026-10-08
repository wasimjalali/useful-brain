"use client";

import { useState } from "react";

import { ChevronRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { StatusDot, type StatusTone } from "@/components/ui/status";
import type {
  ActivityOutcome,
  ActivityRowView,
  TraceStepView,
} from "@/lib/contracts/admin-insights-view";

const OUTCOME: Record<ActivityOutcome, { label: string; tone: StatusTone }> = {
  answered: { label: "Answered", tone: "success" },
  no_evidence: { label: "No evidence", tone: "faint" },
  approved: { label: "Approved", tone: "success" },
  denied: { label: "Denied", tone: "muted" },
  error: { label: "Error", tone: "danger" },
};

const COLS =
  "grid-cols-[20px_72px_132px_minmax(0,1fr)_108px_64px_64px] gap-x-3.5";

export function ActivityTable({
  rows,
  loadTrace,
  traces,
  traceFailed = {},
  loadMoreFailed = false,
  onLoadMore,
  hasMore,
  loadingMore,
}: {
  rows: ActivityRowView[];
  /** Called when a row opens so the page can fetch its trace. */
  loadTrace: (id: string) => void;
  /** Trace per row id. A missing entry means it is still loading. */
  traces: Record<string, TraceStepView[] | undefined>;
  /** Row ids whose trace request failed, so the row can offer a retry. */
  traceFailed?: Record<string, boolean | undefined>;
  loadMoreFailed?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = (id: string) => {
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    loadTrace(id);
  };

  return (
    <div aria-label="Activity" role="table">
      <div className="px-0" role="rowgroup">
        <div
          className={`grid ${COLS} h-8 items-center border-b border-border px-3 text-xs font-medium text-ink-faint-text`}
          role="row"
        >
          <span role="columnheader">
            <span className="sr-only">Details</span>
          </span>
          <span role="columnheader">Time (UTC)</span>
          <span role="columnheader">Person</span>
          <span role="columnheader">Question</span>
          <span role="columnheader">Outcome</span>
          <span className="text-right" role="columnheader">
            Sources
          </span>
          <span className="text-right" role="columnheader">
            Latency
          </span>
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((r) => {
          const isOpen = openId === r.id;
          const o = OUTCOME[r.outcome];
          const trace = traces[r.id];
          return (
            <div key={r.id}>
              <div
                className={`grid ${COLS} h-12 w-full cursor-pointer items-center rounded-[10px] px-3 text-left text-ink transition-colors duration-[120ms] hover:bg-sunken ${
                  isOpen ? "bg-sunken" : "bg-transparent"
                }`}
                onClick={() => toggle(r.id)}
                role="row"
              >
                <span role="cell">
                  <button
                    aria-controls={`trace-${r.id}`}
                    aria-expanded={isOpen}
                    aria-label={`Details for ${r.question}`}
                    className="ub-ring inline-flex rounded text-ink-muted"
                    type="button"
                  >
                    <span
                      className="inline-flex transition-transform duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                      data-testid="row-chevron"
                      style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                    >
                      <ChevronRightIcon className="size-[15px]" />
                    </span>
                  </button>
                </span>
                <span className="font-mono text-xs text-ink-muted" role="cell">
                  {r.time}
                </span>
                <span className="truncate text-[13px]" role="cell">
                  {r.person}
                </span>
                <span className="truncate text-[13px]" role="cell" title={r.question}>
                  {r.question}
                </span>
                <span className="inline-flex items-center gap-[7px] text-[13px]" role="cell">
                  <StatusDot tone={o.tone} />
                  {o.label}
                </span>
                <span className="text-right text-[13px] text-ink-muted" role="cell">
                  {r.sources ?? "-"}
                </span>
                <span className="text-right font-mono text-xs text-ink-muted" role="cell">
                  {r.latency}
                </span>
              </div>
              {isOpen ? (
                <div
                  aria-label={`Trace for ${r.question}`}
                  className="mb-3 ml-[46px] mr-3 mt-1 grid grid-cols-[96px_minmax(0,1fr)_64px] gap-x-4 gap-y-[9px] rounded-[14px] bg-sunken px-4 py-3.5 font-mono text-xs leading-[18px]"
                  id={`trace-${r.id}`}
                  role="group"
                >
                  {traceFailed[r.id] ? (
                    <span className="col-span-3 flex items-center gap-3 text-ink">
                      Could not load this trace
                      <Button onClick={() => loadTrace(r.id)} size={32} variant="secondary">
                        Retry trace
                      </Button>
                    </span>
                  ) : trace === undefined ? (
                    <span className="col-span-3 text-ink-faint-text">Loading trace</span>
                  ) : trace.length === 0 ? (
                    <span className="col-span-3 text-ink-faint-text">No trace recorded</span>
                  ) : (
                    trace.map((t, i) => (
                      <TraceLine key={`${t.step}-${i}`} step={t} />
                    ))
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {hasMore ? (
        <div className="flex flex-col items-center gap-2 pt-4">
          {loadMoreFailed ? (
            <p className="text-[13px] text-danger" role="alert">
              Couldn&apos;t load more activity. Try again.
            </p>
          ) : null}
          <Button disabled={loadingMore} onClick={onLoadMore} variant="secondary">
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TraceLine({ step }: { step: TraceStepView }) {
  return (
    <>
      <span className="text-ink-faint-text">{step.step}</span>
      <span className="whitespace-pre-wrap break-words text-ink">{step.detail}</span>
      <span className="text-right text-ink-muted">{step.duration}</span>
    </>
  );
}
