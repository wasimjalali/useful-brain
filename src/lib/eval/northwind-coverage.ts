import { EVAL_CATEGORIES, type EvalCategory } from "./northwind-loader";

/**
 * Production RAG axes the Northwind 120-question set is meant to expose.
 * Retrieval metrics (recall/MRR/nDCG/ACL) and grounded-answer checks both
 * map onto these axes; live chat on loopback cannot substitute for ACL.
 */
export const PRODUCTION_EVAL_AXES = [
  "retrieval_quality",
  "answer_accuracy",
  "response_relevance",
  "citation_grounding",
  "structured_output",
  "context_multi_hop",
  "abstention",
  "acl_isolation",
  "trap_robustness",
] as const;

export type ProductionEvalAxis = (typeof PRODUCTION_EVAL_AXES)[number];

export const NORTHWIND_CATEGORY_AXES: Record<EvalCategory, ProductionEvalAxis[]> = {
  factual: ["retrieval_quality", "answer_accuracy", "response_relevance", "citation_grounding", "structured_output"],
  trap: ["retrieval_quality", "trap_robustness", "citation_grounding", "answer_accuracy"],
  permission: ["acl_isolation", "abstention", "structured_output"],
  unanswerable: ["abstention", "structured_output", "citation_grounding"],
  multi_hop: ["context_multi_hop", "retrieval_quality", "citation_grounding", "answer_accuracy"],
  multi_hop_expanded: ["context_multi_hop", "retrieval_quality", "citation_grounding", "answer_accuracy"],
};

export const COVERAGE_FLOORS: Record<EvalCategory, number> = {
  factual: 40,
  trap: 10,
  permission: 8,
  unanswerable: 8,
  multi_hop: 4,
  multi_hop_expanded: 4,
};

export function axesCoveredByCategories(counts: Record<EvalCategory, number>): ProductionEvalAxis[] {
  const covered = new Set<ProductionEvalAxis>();
  for (const category of EVAL_CATEGORIES) {
    if ((counts[category] ?? 0) <= 0) {
      continue;
    }
    for (const axis of NORTHWIND_CATEGORY_AXES[category]) {
      covered.add(axis);
    }
  }
  return PRODUCTION_EVAL_AXES.filter((axis) => covered.has(axis));
}

export function coverageGaps(counts: Record<EvalCategory, number>): string[] {
  const gaps: string[] = [];
  for (const category of EVAL_CATEGORIES) {
    const have = counts[category] ?? 0;
    const floor = COVERAGE_FLOORS[category];
    if (have < floor) {
      gaps.push(`${category}: ${have} questions, need at least ${floor}`);
    }
  }
  const axes = new Set(axesCoveredByCategories(counts));
  for (const axis of PRODUCTION_EVAL_AXES) {
    if (!axes.has(axis)) {
      gaps.push(`missing production axis: ${axis}`);
    }
  }
  return gaps;
}
