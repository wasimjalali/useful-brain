import path from "node:path";

import { describe, expect, it } from "vitest";

import { EVAL_OUTPUT_DIR, outputPaths, parseArgs } from "./live-northwind-eval";
import { loadDocuments, loadQuestions } from "./northwind-loader";

// Ways a tuning run could be mistaken for the locked battery:
// 1. a dangling --questions silently falls back to questions.json;
// 2. --questions names the locked file itself and records it as tuning;
// 3. tuning outputs land on the locked checkpoint/summary/findings paths,
//    so a later --resume of the locked run picks tuning rows up;
// 4. a per-model tuning run overwrites another model's tuning run;
// 5. the tuning file fails to load against the corpus (unknown principal,
//    missing document) and the run proceeds with zero questions.
describe("live Northwind eval --questions", () => {
  it("fails closed on a dangling --questions", () => {
    expect(() => parseArgs(["--questions"])).toThrow(/requires a question file/);
    expect(() => parseArgs(["--questions", "--live", "http://x"])).toThrow(
      /requires a question file/,
    );
  });

  it("refuses the locked question file", () => {
    expect(() => parseArgs(["--questions", "content/northwind/questions.json"])).toThrow(
      /tuning sets/,
    );
  });

  it("resolves the tuning file and keeps the locked run without it", () => {
    expect(parseArgs(["--questions", "content/northwind/tuning-questions.json"]).questionsFile).toBe(
      path.resolve("content/northwind/tuning-questions.json"),
    );
    expect(parseArgs([]).questionsFile).toBeUndefined();
  });

  it("writes tuning outputs apart from the locked outputs", () => {
    const locked = outputPaths(undefined);
    const tuning = outputPaths(undefined, "content/northwind/tuning-questions.json");
    for (const key of ["checkpoint", "summary", "findings", "retrievalReport"] as const) {
      expect(tuning[key]).not.toBe(locked[key]);
      expect(tuning[key].startsWith(path.join(EVAL_OUTPUT_DIR, "tuning", "tuning-questions"))).toBe(
        true,
      );
    }
    expect(outputPaths("@cf/zai-org/glm-5.3", "tuning-questions.json").findings).not.toBe(
      tuning.findings,
    );
  });

  it("loads the checked-in tuning set against the corpus", () => {
    const root = path.join(process.cwd(), "content/northwind");
    const { questions } = loadQuestions(
      path.join(root, "tuning-questions.json"),
      loadDocuments(root),
    );
    expect(questions.length).toBeGreaterThanOrEqual(10);
    expect(questions.every((question) => question.questionId.startsWith("tq"))).toBe(true);
  });
});
