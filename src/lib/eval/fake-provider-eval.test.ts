import { describe, expect, it } from "vitest";

import { ingestNorthwind } from "./ingest-northwind";
import { loadNorthwindCorpus } from "./northwind-loader";
import { runRetrievalEvals } from "./run-retrieval-eval";

const FAKE_FLOORS = {
  recallAtK: 0.9,
  mrr: 0.8,
  ndcgAtK: 0.82,
  citationCorrectness: 0.49,
};

describe("fake-provider Northwind ratchet", () => {
  it("meets the locked fake-provider floors with zero ACL leaks", async () => {
    const { documents, questions } = loadNorthwindCorpus();
    const { pipeline, chunkCount } = await ingestNorthwind(documents);
    expect(chunkCount).toBeGreaterThan(600);
    const report = await runRetrievalEvals(pipeline, questions, 3);
    expect(report.aclLeakCount).toBe(0);
    expect(report.recallAtK).toBeGreaterThanOrEqual(FAKE_FLOORS.recallAtK);
    expect(report.mrr).toBeGreaterThanOrEqual(FAKE_FLOORS.mrr);
    expect(report.ndcgAtK).toBeGreaterThanOrEqual(FAKE_FLOORS.ndcgAtK);
    expect(report.citationCorrectness).toBeGreaterThanOrEqual(FAKE_FLOORS.citationCorrectness);

    const locked = report.results.filter((result) => ["q086", "q087", "q088", "q089", "q090"].includes(result.questionId));
    const expanded = report.results.filter((result) =>
      ["q116", "q117", "q118", "q119", "q120"].includes(result.questionId),
    );
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(locked.map((result) => result.recall))).toBeGreaterThanOrEqual(0.75);
    expect(mean(expanded.map((result) => result.recall))).toBeGreaterThanOrEqual(0.55);
  }, 60_000);
});
