import { describe, expect, it } from "vitest";

import { answerFromEvidence } from "../answer/contract";
import { hitsToEvidence } from "../answer/evidence";
import { ingestNorthwind } from "./ingest-northwind";
import { loadNorthwindCorpus } from "./northwind-loader";

describe("locked unanswerable set", () => {
  it("refuses unsupported grounded answers for q076–q085", async () => {
    const { documents, questions } = loadNorthwindCorpus();
    const unanswerable = questions.filter((question) => question.category === "unanswerable");
    expect(unanswerable.map((question) => question.questionId)).toEqual([
      "q076",
      "q077",
      "q078",
      "q079",
      "q080",
      "q081",
      "q082",
      "q083",
      "q084",
      "q085",
    ]);
    const { pipeline } = await ingestNorthwind(documents);
    for (const question of unanswerable) {
      const response = await pipeline.search({
        query: question.query,
        principal: question.principal,
        topK: 3,
        candidateLimit: 24,
      });
      const evidence = hitsToEvidence(response.hits);
      const tempting = JSON.stringify({
        answerType: "grounded",
        paragraphs: [
          {
            text: "Yes, that benefit exists and the amount is 42.",
            citations: evidence[0] ? [evidence[0].citationLabel] : ["[1]"],
          },
        ],
      });
      const parsed = answerFromEvidence(tempting, evidence);
      expect(parsed.answerType).toBe("insufficient_evidence");
      expect(parsed.paragraphs.every((paragraph) => paragraph.citations.length === 0)).toBe(true);
    }
  }, 60_000);
});
