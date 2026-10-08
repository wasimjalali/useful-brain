"use client";

import { useState } from "react";

import { ChevronRightIcon } from "@/components/icons";
import type { EvalFailureView } from "@/lib/contracts/admin-insights-view";

function askedAsLabel(role: string): string {
  const spaced = role.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

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
              <span className="justify-self-start rounded-md bg-sunken px-[7px] py-px text-xs text-ink-muted">{f.category}</span>
              <span className="truncate text-[13px] leading-5">{f.question}</span>
            </button>
            {isOpen ? (
              <dl
                className="m-0 mb-3 ml-7 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md bg-sunken px-3 py-2.5 text-[13px] leading-5"
                id={panelId}
              >
                <dt className="text-ink-faint-text">Asked as</dt>
                <dd className="m-0 text-ink">{askedAsLabel(f.askedAs)}</dd>
                <dt className="text-ink-faint-text">Expected</dt>
                <dd className="m-0 flex flex-col gap-0.5 text-ink">
                  {f.expected.map((e) => (
                    <span key={`${e.document}:${e.section}`}>
                      {e.document} <span className="text-ink-faint-text">{`· ${e.section}`}</span>
                    </span>
                  ))}
                </dd>
                <dt className="text-ink-faint-text">Looks for</dt>
                <dd className="m-0 text-ink-muted">{f.note}</dd>
              </dl>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
