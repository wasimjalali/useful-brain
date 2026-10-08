import type {
  ActivityFilterValue,
  ActivityFilterView,
  ActivityOutcome,
  ActivityRowView,
  TraceStepView,
} from "@/lib/contracts/admin-insights-view";
import {
  ACTIVITY_OUTCOMES,
  type ActivityResponse,
  type ActivityRow,
  type TurnStep,
} from "@/lib/contracts/admin-metrics";

const LABEL: Record<ActivityOutcome, string> = {
  answered: "Answered",
  no_evidence: "No evidence",
  approved: "Approved",
  denied: "Denied",
  error: "Error",
};

const EMPTY: Record<ActivityOutcome, string> = {
  answered: "No answered questions",
  no_evidence: "No questions without evidence",
  approved: "No approved actions",
  denied: "No denied actions",
  error: "No errors",
};

export function emptyMessage(outcome: ActivityOutcome): string {
  return `${EMPTY[outcome]} this week`;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function mapRows(rows: ActivityRow[]): ActivityRowView[] {
  return rows.map((r) => ({
    id: r.messageId,
    time: clock(r.createdAt),
    person: r.person,
    question: r.question,
    outcome: r.outcome,
    sources: r.sources,
    latency: r.latencyMs === null ? "-" : `${(r.latencyMs / 1000).toFixed(1)} s`,
  }));
}

export function mapFilters(total: number, counts: ActivityResponse["counts"]): ActivityFilterView[] {
  return [
    { value: "all" as ActivityFilterValue, label: "All", count: total },
    ...ACTIVITY_OUTCOMES.map((o) => ({ value: o as ActivityFilterValue, label: LABEL[o], count: counts[o] })),
  ];
}

export function mapTrace(steps: TurnStep[]): TraceStepView[] {
  return steps.map((s) => {
    const entries = Object.entries(s.detail).map(([k, v]) => `${k}: ${v === null ? "-" : String(v)}`);
    return {
      step: s.step.replace("_", " "),
      detail: entries.length ? entries.join(" · ") : "-",
      duration: s.durationMs === null ? "-" : `${s.durationMs} ms`,
    };
  });
}
