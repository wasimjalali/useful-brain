import type { KpiView, SystemRowView, UnansweredView } from "@/lib/contracts/admin-insights-view";
import type {
  HealthDetailCode,
  HealthRow,
  HealthService,
  OverviewDay,
  OverviewResponse,
  UnansweredQuestion,
} from "@/lib/contracts/admin-metrics";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MINUS = "−";
const DOT = " · ";
const DAY_MS = 86_400_000;

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function rangeSubtitle(daily: OverviewDay[]): string {
  if (daily.length === 0) throw new Error("overview has no daily points");
  const first = parseDay(daily[0].day);
  const last = parseDay(daily[daily.length - 1].day);
  const from = `${first.getUTCDate()}${first.getUTCMonth() === last.getUTCMonth() ? "" : ` ${MONTHS[first.getUTCMonth()]}`}`;
  return `This week${DOT}${from} to ${last.getUTCDate()} ${MONTHS[last.getUTCMonth()]} ${last.getUTCFullYear()}`;
}

const signed = (n: number, text: string) => `${n < 0 ? MINUS : "+"}${text}`;

export function mapKpis(o: OverviewResponse): KpiView[] {
  const { current: c, previous: p, daily } = o;
  const startLabel = WEEKDAYS[parseDay(daily[0].day).getUTCDay()];
  const endLabel = WEEKDAYS[parseDay(daily[daily.length - 1].day).getUTCDay()];
  const ends = { startLabel, endLabel };
  const series = (pick: (d: OverviewDay) => number | null) =>
    daily.map(pick).filter((v): v is number => v !== null);

  const questionsDelta =
    p.questions === 0
      ? "No questions last week"
      : `${signed(c.questions - p.questions, `${Math.abs(Math.round(((c.questions - p.questions) / p.questions) * 100))}%`)} on last week`;

  let groundedDelta = "No data last week";
  if (c.groundedPercent !== null && p.groundedPercent !== null) {
    const diff = Math.round((c.groundedPercent - p.groundedPercent) * 10) / 10;
    groundedDelta = diff === 0 ? "No change" : `${signed(diff, Math.abs(diff).toFixed(1))} pts`;
  }

  let medianDelta = "No data last week";
  if (c.medianLatencyMs !== null && p.medianLatencyMs !== null) {
    const diff = Math.round((c.medianLatencyMs - p.medianLatencyMs) / 100) / 10;
    medianDelta = diff === 0 ? "No change" : `${signed(diff, Math.abs(diff).toFixed(1))} s`;
  }

  return [
    {
      id: "questions",
      label: "Questions this week",
      value: String(c.questions),
      delta: questionsDelta,
      points: series((d) => d.questions),
      ...ends,
    },
    {
      id: "grounded",
      label: "Answered with citations",
      value: c.groundedPercent === null ? "-" : `${c.groundedPercent.toFixed(1)}%`,
      delta: groundedDelta,
      points: series((d) => d.groundedPercent),
      ...ends,
    },
    {
      id: "no-evidence",
      label: "No evidence",
      value: String(c.noEvidence),
      delta: c.questions === 0 ? "No questions" : `${((c.noEvidence / c.questions) * 100).toFixed(1)}% of questions`,
      points: series((d) => d.noEvidence),
      ...ends,
    },
    {
      id: "median",
      label: "Median answer",
      value: c.medianLatencyMs === null ? "-" : `${(c.medianLatencyMs / 1000).toFixed(1)} s`,
      delta: medianDelta,
      points: series((d) => d.medianLatencyMs),
      ...ends,
    },
  ];
}

function lastAsked(at: number, now: number): string {
  const days = Math.floor((now - at) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function uploadHref(): string {
  return "/admin/sources?upload=1";
}

export function mapUnanswered(items: UnansweredQuestion[], now: number): UnansweredView[] {
  return items.map((u) => {
    const parts = [`Last asked ${lastAsked(u.lastAskedAt, now)}`];
    if (u.requests > 0) parts.push(`${u.requests} document request${u.requests === 1 ? "" : "s"}`);
    if (u.likelyDepartment) parts.push(`likely ${u.likelyDepartment}`);
    return { id: u.question, question: u.question, meta: parts.join(DOT), asks: u.asks };
  });
}

const SERVICE_NAME: Record<HealthService, string> = {
  brain: "Brain worker",
  corpus_db: "Corpus database",
  vector_index: "Vector index",
  workers_ai: "Workers AI",
  ai_gateway: "AI Gateway",
};

const DETAIL_COPY: Record<HealthDetailCode, string> = {
  ok: "Healthy",
  unreachable: "Unreachable",
  synced: "Synced",
  no_active_generation: "No active generation",
  no_audit: "Not audited yet",
  audit_partial: "Audit incomplete",
  audit_unsupported: "Audit unavailable",
  drift: "Out of sync",
  stale_audit: "Audit is out of date",
  no_calls_yet: "No calls yet",
  last_call_ok: "Healthy",
  last_call_failed: "Last call failed",
  timeout: "Last call timed out",
  rate_limited: "Rate limited",
  not_in_call_path: "Not in the call path",
};

export function mapHealth(rows: HealthRow[]): SystemRowView[] {
  return rows.map((r) => {
    const synced = r.detail === "synced";
    const detail = synced && r.generationId ? `Synced to ${r.generationId}` : DETAIL_COPY[r.detail];
    return {
      id: `${r.service}-${r.detail}`,
      name: SERVICE_NAME[r.service],
      status: r.status,
      detail,
      mono: synced && Boolean(r.generationId),
    };
  });
}
