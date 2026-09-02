"use client";

import { useMemo, useState } from "react";

import {
  campaignRun,
  formatPassRate,
  NORTHWIND_CAMPAIGN,
  type CampaignCategoryId,
  type CampaignKey,
} from "@/lib/eval/campaign-snapshot";

export function EvaluationsWorkspace() {
  const [runKey, setRunKey] = useState<CampaignKey>(NORTHWIND_CAMPAIGN.latestKey);
  const [category, setCategory] = useState<"all" | CampaignCategoryId>("all");
  const [openFailure, setOpenFailure] = useState<string | null>(null);

  const run = campaignRun(runKey);
  const failures = useMemo(
    () =>
      run.failures.filter((item) => category === "all" || item.category === category),
    [category, run.failures],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">
            Evals
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {NORTHWIND_CAMPAIGN.title} · {NORTHWIND_CAMPAIGN.model}
          </p>
        </div>
        <div
          aria-label="Campaign run"
          className="flex rounded-full border border-border bg-sunken p-1"
          role="tablist"
        >
          {NORTHWIND_CAMPAIGN.runs.map((item) => (
            <button
              aria-selected={item.key === runKey}
              className={[
                "min-h-9 rounded-full px-3 text-sm",
                item.key === runKey ? "bg-surface font-medium text-ink" : "text-ink-muted",
              ].join(" ")}
              key={item.key}
              onClick={() => {
                setRunKey(item.key);
                setCategory("all");
                setOpenFailure(null);
              }}
              role="tab"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <section
        aria-labelledby="eval-score-heading"
        className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-end"
      >
        <div>
          <h2 className="sr-only" id="eval-score-heading">
            Score
          </h2>
          <p className="tnum text-5xl font-semibold tracking-[-0.04em] text-ink">
            {run.passed}
            <span className="text-ink-faint">/{run.scored}</span>
          </p>
          <p className="mt-2 tnum text-sm text-ink-muted">
            {formatPassRate(run.passRate)} · {run.date}
          </p>
        </div>
        <p className="max-w-xl text-sm leading-6 text-ink-muted">{run.note}</p>
      </section>

      {run.categories.length > 0 ? (
        <section aria-labelledby="eval-categories-heading">
          <h2 className="sr-only" id="eval-categories-heading">
            Categories
          </h2>
          <div className="grid gap-3 sm:grid-cols-5">
            {run.categories.map((item) => {
              const active = category === item.id;
              const rate = item.scored === 0 ? 0 : item.passed / item.scored;
              return (
                <button
                  aria-pressed={active}
                  className={[
                    "rounded-2xl border px-3 py-3 text-left transition",
                    active
                      ? "border-ink bg-sunken"
                      : "border-border bg-surface hover:border-border-strong",
                  ].join(" ")}
                  key={item.id}
                  onClick={() =>
                    setCategory((current) => (current === item.id ? "all" : item.id))
                  }
                  type="button"
                >
                  <p className="text-xs text-ink-faint">{item.label}</p>
                  <p className="tnum mt-1 text-lg font-semibold text-ink">
                    {item.passed}/{item.scored}
                  </p>
                  <span
                    aria-hidden="true"
                    className="mt-2 block h-1 overflow-hidden rounded-full bg-sunken"
                  >
                    <span
                      className="block h-full rounded-full bg-ink"
                      style={{ width: `${Math.round(rate * 100)}%` }}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="eval-constants-heading">
        <h2 className="text-sm font-medium text-ink" id="eval-constants-heading">
          Retrieval held constant
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-4">
          <Constant label="ACL leaks" value={String(NORTHWIND_CAMPAIGN.retrieval.aclLeaks)} />
          <Constant
            label="Live retrieved recall"
            value={NORTHWIND_CAMPAIGN.retrieval.liveRetrievedRecall.toFixed(3)}
          />
          <Constant
            label="Recall@3"
            value={NORTHWIND_CAMPAIGN.retrieval.recallAt3.toFixed(3)}
          />
          <Constant label="MRR" value={NORTHWIND_CAMPAIGN.retrieval.mrr.toFixed(3)} />
        </dl>
      </section>

      <section aria-labelledby="eval-failures-heading">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-sm font-medium text-ink" id="eval-failures-heading">
            Remaining failures
          </h2>
          <p className="tnum text-xs text-ink-faint">{failures.length}</p>
        </div>
        {failures.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            {run.failures.length === 0
              ? "This run has no frozen per-question remainder."
              : "No failures in this category."}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {failures.map((item) => {
              const open = openFailure === item.id;
              return (
                <li key={item.id}>
                  <button
                    aria-expanded={open}
                    className="flex w-full items-start justify-between gap-4 py-3 text-left"
                    onClick={() =>
                      setOpenFailure((current) => (current === item.id ? null : item.id))
                    }
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="font-mono text-sm font-medium text-ink">{item.id}</span>
                      <span className="ml-2 text-xs text-ink-faint">{item.category}</span>
                      {open ? (
                        <span className="mt-2 block text-sm leading-6 text-ink-muted">
                          {item.detail}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-xs text-ink-faint">{open ? "Hide" : "Open"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Constant({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="tnum mt-1 text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}
