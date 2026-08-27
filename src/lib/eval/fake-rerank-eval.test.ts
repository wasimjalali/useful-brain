import { describe, expect, it } from "vitest";

import { ingestNorthwind } from "./ingest-northwind";
import { loadNorthwindCorpus } from "./northwind-loader";
import { runRetrievalEvals } from "./run-retrieval-eval";
import { FAKE_RERANK_FINGERPRINT } from "../retrieve/fingerprint";
import { FakeReranker } from "../retrieve/rerank";

const RERANK_FLOORS = {
  recallAtK: 0.62,
  mrr: 0.53,
  ndcgAtK: 0.55,
  citationCorrectness: 0.39,
};

describe("fake-rerank Northwind ratchet", () => {
  it("meets the locked fake-rerank floors without mixing the shipped no-reranker path", async () => {
    const { documents, questions } = loadNorthwindCorpus();
    const { pipeline } = await ingestNorthwind(documents, {
      fingerprint: FAKE_RERANK_FINGERPRINT,
      reranker: new FakeReranker(),
    });
    const report = await runRetrievalEvals(pipeline, questions, 3);
    expect(report.aclLeakCount).toBe(0);
    expect(report.recallAtK).toBeGreaterThanOrEqual(RERANK_FLOORS.recallAtK);
    expect(report.mrr).toBeGreaterThanOrEqual(RERANK_FLOORS.mrr);
    expect(report.ndcgAtK).toBeGreaterThanOrEqual(RERANK_FLOORS.ndcgAtK);
    expect(report.citationCorrectness).toBeGreaterThanOrEqual(RERANK_FLOORS.citationCorrectness);
  }, 60_000);
});
