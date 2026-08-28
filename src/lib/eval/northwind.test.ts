import { describe, expect, it } from "vitest";

import { loadNorthwindCorpus } from "./northwind-loader";
import { northwindSeedDocuments } from "./northwind-seed";

describe("Northwind eval corpus", () => {
  it("loads 65 documents and 120 unique questions", () => {
    const { documents, questions, principals } = loadNorthwindCorpus();
    const seed = northwindSeedDocuments();
    expect(documents).toHaveLength(65);
    expect(seed).toHaveLength(65);
    expect(seed.map((document) => document.documentId).sort()).toEqual(
      documents.map((document) => document.documentId).sort(),
    );
    expect(questions).toHaveLength(120);
    expect(new Set(questions.map((question) => question.questionId)).size).toBe(120);
    expect(questions[0].questionId).toBe("q001");
    expect(questions[119].questionId).toBe("q120");
    expect(Object.keys(principals)).toHaveLength(15);
    expect(questions.filter((question) => question.category === "multi_hop").map((q) => q.questionId)).toEqual([
      "q086",
      "q087",
      "q088",
      "q089",
      "q090",
    ]);
    expect(questions.filter((question) => question.category === "multi_hop_expanded").map((q) => q.questionId)).toEqual([
      "q116",
      "q117",
      "q118",
      "q119",
      "q120",
    ]);
  });
});
