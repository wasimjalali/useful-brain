/** Wire contracts for the admin Overview, Unanswered, Health, Activity and Evals read-outs. */

export type AdminRange = "7d";

export type OverviewTotals = {
  questions: number;
  grounded: number;
  /** Null when there are no questions. */
  groundedPercent: number | null;
  noEvidence: number;
  /** Null when no completed turn in the window has a recorded latency. */
  medianLatencyMs: number | null;
  /** Turns that contributed to the median. Older turns have no latency. */
  latencySamples: number;
};

export type OverviewDay = OverviewTotals & {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
};

export type OverviewResponse = {
  range: AdminRange;
  generatedAt: number;
  current: OverviewTotals;
  previous: OverviewTotals;
  /** Seven points, oldest first, the last one is today (UTC). */
  daily: OverviewDay[];
};

export type UnansweredQuestion = {
  question: string;
  asks: number;
  lastAskedAt: number;
  requests: number;
  /** Present only when a below-floor candidate department was recorded. */
  likelyDepartment?: string;
};

export type UnansweredResponse = { range: AdminRange; questions: UnansweredQuestion[] };

export type HealthStatus = "ok" | "warning" | "error";

export type HealthService = "brain" | "corpus_db" | "vector_index" | "workers_ai" | "ai_gateway";

/** Closed set. The UI maps each code to copy. */
export const HEALTH_DETAIL_CODES = [
  "ok",
  "unreachable",
  "synced",
  "no_active_generation",
  "no_audit",
  "audit_partial",
  "audit_unsupported",
  "drift",
  "stale_audit",
  "no_calls_yet",
  "last_call_ok",
  "last_call_failed",
  "timeout",
  "rate_limited",
  "not_in_call_path",
] as const;
export type HealthDetailCode = (typeof HEALTH_DETAIL_CODES)[number];

export type HealthRow = {
  service: HealthService;
  status: HealthStatus;
  detail: HealthDetailCode;
  /** Active generation id for the vector index row. */
  generationId?: string;
  /** Epoch ms of the evidence behind the row, when there is one. */
  at?: number;
};

export type HealthResponse = { services: HealthRow[] };

export type ActivityOutcome = "answered" | "no_evidence" | "approved" | "denied" | "error";
export const ACTIVITY_OUTCOMES: readonly ActivityOutcome[] = [
  "answered",
  "no_evidence",
  "approved",
  "denied",
  "error",
];

export type ActivityRow = {
  messageId: string;
  createdAt: number;
  person: string;
  question: string;
  outcome: ActivityOutcome;
  sources: number;
  latencyMs: number | null;
};

export type ActivityResponse = {
  range: AdminRange;
  total: number;
  counts: Record<ActivityOutcome, number>;
  rows: ActivityRow[];
  nextCursor: string | null;
};

export const TURN_STEP_NAMES = [
  "rewrite",
  "retrieve",
  "rerank",
  "generate",
  "tool_call",
  "approval",
  "result",
] as const;
export type TurnStepName = (typeof TURN_STEP_NAMES)[number];

export type TurnStepDetail = Record<string, string | number | boolean | null>;

export type TurnStep = {
  seq: number;
  step: TurnStepName;
  detail: TurnStepDetail;
  durationMs: number | null;
};

export type ActivityTraceResponse = { messageId: string; steps: TurnStep[] };

export type EvalRunSummary = {
  key: string;
  label: string;
  date: string;
  passed: number;
  scored: number;
  passRate: number;
  note: string;
};

export type EvalFailure = {
  id: string;
  category: string;
  detail: string;
  question: string;
  askedAs: string;
  expected: { documentId: string; title: string; section: string | null }[];
  note: string;
};

export type EvalsAdminView = {
  title: string;
  model: string;
  questions: number;
  documents: number;
  latestKey: string;
  runs: EvalRunSummary[];
  categories: { id: string; label: string; passed: number; scored: number }[];
  retrieval: {
    recallAt3: number;
    mrr: number;
    ndcg: number;
    liveRetrievedRecall: number;
    aclLeaks: number;
  };
  failures: EvalFailure[];
};
