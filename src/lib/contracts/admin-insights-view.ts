/** View models for the admin Overview, Evals and Activity screens. */

export type KpiView = {
  id: string;
  label: string;
  value: string;
  delta: string;
  /** Daily values, oldest first. */
  points: number[];
  /** Labels under the sparkline, taken from the data. */
  startLabel: string;
  endLabel: string;
};

export type UnansweredView = {
  id: string;
  question: string;
  meta: string;
  asks: number;
};

export type SystemRowView = {
  id: string;
  name: string;
  status: "ok" | "warning" | "error";
  detail?: string;
  /** Full value behind a shortened detail. */
  title?: string;
  mono?: boolean;
};

export type EvalsSummaryView = {
  passed: number;
  total: number;
  aclLeaks: number;
  latestRunLabel: string;
};

export type EvalRunView = {
  id: string;
  name: string;
  date: string;
  passed: number;
  total: number;
};

export type EvalCategoryView = { id: string; name: string; passed: number; total: number };

export type RetrievalMetricView = {
  id: string;
  label: string;
  value: string;
  tone?: "success";
};

export type EvalFailureView = {
  id: string;
  category: string;
  question: string;
  askedAs: string;
  expected: { document: string; section: string }[];
  note: string;
};

export type ActivityOutcome = "answered" | "no_evidence" | "approved" | "denied" | "error";

export type ActivityFilterValue = "all" | ActivityOutcome;

export type ActivityFilterView = { value: ActivityFilterValue; label: string; count: number };

export type TraceStepView = { step: string; detail: string; duration: string };

export type ActivityRowView = {
  id: string;
  time: string;
  person: string;
  question: string;
  outcome: ActivityOutcome;
  /** Null renders an em-free placeholder "-". */
  sources: number | null;
  latency: string;
};
