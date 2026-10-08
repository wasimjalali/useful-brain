import type { ReactNode } from "react";

import { StatusDot, type StatusTone } from "@/components/ui/status";
import type { TraceStepView } from "@/lib/contracts/admin-insights-view";
import { modelDisplayName, shortGenerationId } from "@/lib/labels";

const STEP_NAME: Record<string, string> = {
  rewrite: "Rewrite question",
  retrieve: "Search",
  rerank: "Rerank",
  generate: "Write answer",
  "tool call": "Create ticket",
  tool_call: "Create ticket",
  approval: "Approval",
  result: "Result",
};

const RESULT: Record<string, { label: string; tone: StatusTone }> = {
  grounded: { label: "Answered", tone: "success" },
  insufficient_evidence: { label: "No evidence", tone: "faint" },
};

function humanize(text: string): string {
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function plural(n: string, one: string, many: string): string {
  return `${n} ${n === "1" ? one : many}`;
}

function parseDetail(detail: string): [string, string][] {
  if (detail === "-" || detail.trim() === "") return [];
  return detail.split(" · ").map((part): [string, string] => {
    const at = part.indexOf(": ");
    return at < 0 ? [part, ""] : [part.slice(0, at), part.slice(at + 2)];
  });
}

function millis(duration: string): number | null {
  const m = /^(\d+(?:\.\d+)?) ms$/.exec(duration);
  return m ? Number(m[1]) : null;
}

function Chip({ children, mono, title }: { children: ReactNode; mono?: boolean; title?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-surface px-2.5 py-0.5 text-xs text-ink ${mono ? "font-mono" : ""}`}
      title={title}
    >
      {children}
    </span>
  );
}

function chipText(step: string, key: string, value: string): string {
  switch (`${step}.${key}`) {
    case "rewrite.queryTokens":
      return plural(value, "token", "tokens");
    case "retrieve.mode":
      return value === "hybrid" ? "Hybrid" : value === "keyword_only" ? "Keyword only" : humanize(value);
    case "retrieve.searches":
      return plural(value, "search", "searches");
    case "retrieve.candidates":
      return plural(value, "candidate", "candidates");
    case "retrieve.readable":
      return plural(value, "readable document", "readable documents");
    case "rerank.score1":
      return `Top score ${value}`;
    case "rerank.floor":
      return `Floor ${value}`;
    case "generate.citations":
      return plural(value, "citation", "citations");
    case "generate.toolProposals":
      return plural(value, "ticket proposal", "ticket proposals");
    default:
      return `${humanize(key)} ${value}`.trim();
  }
}

function Chips({ step, detail }: { step: string; detail: string }) {
  const entries = parseDetail(detail);
  return (
    <>
      {entries.map(([k, v]) => {
        if (step === "result" && k === "answerType") {
          const o = RESULT[v] ?? { label: humanize(v), tone: "faint" as StatusTone };
          return (
            <span className="inline-flex items-center gap-[7px] text-[13px] text-ink" key={k}>
              <StatusDot tone={o.tone} />
              {o.label}
            </span>
          );
        }
        if (step === "retrieve" && k === "generation") {
          return (
            <Chip key={k} mono title={v}>
              {shortGenerationId(v)}
            </Chip>
          );
        }
        if (step === "generate" && k === "model") {
          return (
            <Chip key={k} title={v}>
              {modelDisplayName(v)}
            </Chip>
          );
        }
        if (step === "rerank" && /^chunk\d+$/.test(k)) {
          return (
            <Chip key={k} mono title={v}>
              {humanize(k)}
            </Chip>
          );
        }
        return <Chip key={k}>{chipText(step, k, v)}</Chip>;
      })}
    </>
  );
}

export function TraceTimeline({ steps }: { steps: TraceStepView[] }) {
  const timings = steps.map((s) => millis(s.duration));
  const longest = Math.max(0, ...timings.map((t) => t ?? 0));
  const total = timings.reduce<number>((sum, t) => sum + (t ?? 0), 0);
  return (
    <>
      {steps.map((s, i) => {
        const ms = timings[i];
        return (
          <div
            className="col-span-full grid grid-cols-[132px_minmax(0,1fr)_132px] items-center gap-x-4 font-sans text-[13px]"
            key={`${s.step}-${i}`}
          >
            <span className="inline-flex items-center gap-2 text-ink">
              <span aria-hidden className="size-1.5 rounded-full bg-ink-faint" />
              {STEP_NAME[s.step] ?? humanize(s.step)}
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <Chips detail={s.detail} step={s.step} />
            </span>
            <span className="flex items-center justify-end gap-2 text-xs text-ink-muted">
              {s.step === "result" ? (
                total > 0 ? <span>{`${(total / 1000).toFixed(1)} s total`}</span> : null
              ) : ms === null || ms === 0 ? (
                <span className="text-ink-faint-text">instant</span>
              ) : (
                <>
                  <span aria-hidden className="h-1 w-12 overflow-hidden rounded-full bg-border">
                    <span
                      className="block h-full rounded-full bg-ink-muted"
                      data-testid={`bar-${s.step}`}
                      style={{ width: `${Math.round((ms / longest) * 100)}%` }}
                    />
                  </span>
                  <span className="font-mono">{`${(ms / 1000).toFixed(1)} s`}</span>
                </>
              )}
            </span>
          </div>
        );
      })}
    </>
  );
}
