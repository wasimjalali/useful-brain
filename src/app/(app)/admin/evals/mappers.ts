import type {
  EvalCategoryView,
  EvalFailureView,
  EvalRunView,
  EvalsSummaryView,
  RetrievalMetricView,
} from "@/lib/contracts/admin-insights-view";
import type { EvalsAdminView } from "@/lib/contracts/admin-metrics";

export type EvalsPageView = {
  subtitle: string;
  model: string;
  runs: EvalRunView[];
  categories: EvalCategoryView[];
  metrics: RetrievalMetricView[];
  failures: EvalFailureView[];
  failureCount: number;
  total: number;
};

const NUMBER_WORD: Record<number, string> = { 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven" };

function latestRun(view: EvalsAdminView) {
  const run = view.runs.find((r) => r.key === view.latestKey);
  if (!run) throw new Error("evals view has no latest run");
  return run;
}

export function mapEvalsSummary(view: EvalsAdminView): EvalsSummaryView {
  const run = latestRun(view);
  return {
    passed: run.passed,
    total: run.scored,
    aclLeaks: view.retrieval.aclLeaks,
    latestRunLabel: `Latest run ${run.date}`,
  };
}

export function mapEvals(view: EvalsAdminView): EvalsPageView {
  const names = new Map(view.categories.map((c) => [c.id, c.label]));
  const count = view.categories.length;
  const r = view.retrieval;
  return {
    subtitle: `${view.questions} questions across ${NUMBER_WORD[count] ?? count} categories, run against the active generation`,
    model: view.model,
    runs: view.runs.map((x) => ({ id: x.key, name: x.label, date: x.date, passed: x.passed, total: x.scored })),
    categories: view.categories.map((c) => ({ id: c.id, name: c.label, passed: c.passed, total: c.scored })),
    metrics: [
      { id: "acl", label: "ACL leaks", value: String(r.aclLeaks), tone: r.aclLeaks === 0 ? "success" : undefined },
      { id: "live", label: "Live recall", value: r.liveRetrievedRecall.toFixed(3) },
      { id: "recall3", label: "Recall@3", value: r.recallAt3.toFixed(3) },
      { id: "mrr", label: "MRR", value: r.mrr.toFixed(3) },
    ],
    failures: view.failures.map((f) => {
      const category = names.get(f.category);
      if (!category) throw new Error(`failure ${f.id} has unknown category ${f.category}`);
      return {
        id: f.id,
        category,
        question: f.question,
        askedAs: f.askedAs,
        expected: f.expected.map((e) => ({ document: e.title, section: e.section ?? "Whole document" })),
        note: f.note,
      };
    }),
    failureCount: view.failures.length,
    total: view.questions,
  };
}
