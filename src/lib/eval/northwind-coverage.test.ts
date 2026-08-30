import { describe, expect, it } from "vitest";

import {
  COVERAGE_FLOORS,
  PRODUCTION_EVAL_AXES,
  axesCoveredByCategories,
  coverageGaps,
} from "./northwind-coverage";
import { EVAL_CATEGORIES, loadNorthwindCorpus, type EvalCategory } from "./northwind-loader";

describe("Northwind production-eval coverage", () => {
  it("covers every production RAG axis with the 120-question set", () => {
    const { questions } = loadNorthwindCorpus();
    const counts = Object.fromEntries(EVAL_CATEGORIES.map((category) => [category, 0])) as Record<
      EvalCategory,
      number
    >;
    for (const question of questions) {
      counts[question.category] += 1;
    }
    expect(coverageGaps(counts)).toEqual([]);
    expect(axesCoveredByCategories(counts)).toEqual([...PRODUCTION_EVAL_AXES]);
    for (const category of EVAL_CATEGORIES) {
      expect(counts[category]).toBeGreaterThanOrEqual(COVERAGE_FLOORS[category]);
    }
    expect(questions.filter((question) => question.category === "permission").every((question) => question.forbiddenDocumentIds.length > 0)).toBe(true);
    expect(questions.filter((question) => question.category === "unanswerable").every((question) => question.expectedDocumentIds.length === 0)).toBe(true);
  });
});
