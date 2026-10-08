"use client";

import { useState } from "react";

import { ChevronRightIcon } from "@/components/icons";
import type { EvalFailureView } from "@/lib/contracts/admin-insights-view";

export function FailuresList({
  failures,
  initiallyOpenId,
}: {
  failures: EvalFailureView[];
  initiallyOpenId?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(initiallyOpenId ? [initiallyOpenId] : []),
  );
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <ul className="m-0 list-none p-0">
      {failures.map((f) => {
        const isOpen = open.has(f.id);
        const panelId = `failure-${f.id}`;
        return (
          <li className="border-b border-border" key={f.id}>
            <button
              aria-controls={panelId}
              aria-expanded={isOpen}
              className="ub-ring grid min-h-12 w-full grid-cols-[16px_44px_88px_minmax(0,1fr)] items-center gap-x-3 rounded-md text-left text-ink"
              onClick={() => toggle(f.id)}
              type="button"
            >
              <span
                className="inline-flex text-ink-muted transition-transform duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                data-testid="failure-chevron"
                style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                <ChevronRightIcon className="size-[15px]" />
              </span>
              <span className="font-mono text-xs">{f.id}</span>
              <span className="text-xs text-ink-muted">{f.category}</span>
              <span className="truncate text-[13px] leading-5">{f.question}</span>
            </button>
            {isOpen ? (
              <div
                className="mb-4 ml-7 grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px] leading-5"
                id={panelId}
              >
                <span className="text-ink-faint-text">Asked as</span>
                <span className="font-mono text-xs text-ink">{f.askedAs}</span>
                <span className="text-ink-faint-text">Expected</span>
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {f.expected.map((e) => (
                    <li className="text-ink" key={`${e.document}:${e.section}`}>
                      {e.document} <span className="text-ink-faint-text">{`· ${e.section}`}</span>
                    </li>
                  ))}
                </ul>
                <span className="text-ink-faint-text">Note</span>
                <span className="text-ink-muted">{f.note}</span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
