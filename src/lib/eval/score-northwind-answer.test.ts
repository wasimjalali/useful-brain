import { describe, expect, it } from "vitest";

import type { EvalQuestion } from "./northwind-loader";
import { scoreNorthwindAnswer, type NorthwindAnswerForEval } from "./score-northwind-answer";

function question(overrides: Partial<EvalQuestion> = {}): EvalQuestion {
  return {
    questionId: "q001",
    category: "factual",
    query: "How many vacation days?",
    principal: { userId: "eng_ic", roles: ["standard"], departments: ["engineering"] },
    expectedDocumentIds: ["nw_hr_leave_policy"],
    expectedSections: ["Annual Leave Entitlements"],
    forbiddenDocumentIds: [],
    note: "test",
    ...overrides,
  };
}

function answer(overrides: Partial<NorthwindAnswerForEval> = {}): NorthwindAnswerForEval {
  return {
    answer: "London employees receive 25 days. [1]",
    structuredAnswer: {
      answerType: "grounded",
      paragraphs: [{ text: "London employees receive 25 days.", citations: ["[1]"] }],
    },
    retrieval: {
      results: [
        {
          source: "Leave and Time Off Policy",
          section: "Annual Leave Entitlements",
          citationLabel: "[1]",
          documentId: "nw_hr_leave_policy",
        },
      ],
    },
    ...overrides,
  };
}

describe("scoreNorthwindAnswer", () => {
  it("passes a grounded factual answer that cites the expected document and section", () => {
    const outcome = scoreNorthwindAnswer(question(), answer());
    expect(outcome.status).toBe("pass");
    expect(outcome.citedDocumentIds).toEqual(["nw_hr_leave_policy"]);
    expect(outcome.sectionHit).toBe(true);
  });

  it("fails when the model grounds in the wrong document", () => {
    const outcome = scoreNorthwindAnswer(
      question(),
      answer({
        retrieval: {
          results: [
            {
              source: "Employee Handbook",
              section: "Welcome",
              citationLabel: "[1]",
              documentId: "nw_hr_employee_handbook",
            },
          ],
        },
      }),
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.detail).toContain("nw_hr_leave_policy");
  });

  it("requires every expected document on multi-hop questions", () => {
    const outcome = scoreNorthwindAnswer(
      question({
        questionId: "q086",
        category: "multi_hop",
        expectedDocumentIds: ["doc_a", "doc_b"],
        expectedSections: [],
      }),
      answer({
        retrieval: {
          results: [
            { source: "A", citationLabel: "[1]", documentId: "doc_a" },
            { source: "B", citationLabel: "[2]", documentId: "doc_b" },
          ],
        },
        structuredAnswer: {
          answerType: "grounded",
          paragraphs: [{ text: "Combined.", citations: ["[1]"] }],
        },
      }),
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.detail).toContain("doc_b");
  });

  it("passes unanswerable when the structured type is insufficient_evidence", () => {
    const outcome = scoreNorthwindAnswer(
      question({
        questionId: "q076",
        category: "unanswerable",
        expectedDocumentIds: [],
        expectedSections: [],
      }),
      answer({
        answer: "Not in the corpus.",
        structuredAnswer: {
          answerType: "insufficient_evidence",
          paragraphs: [{ text: "Not in the corpus.", citations: [] }],
        },
        retrieval: { results: [] },
      }),
    );
    expect(outcome.status).toBe("pass");
  });

  it("skips permission questions on the live loopback path", () => {
    const outcome = scoreNorthwindAnswer(
      question({
        questionId: "q066",
        category: "permission",
        expectedDocumentIds: [],
        forbiddenDocumentIds: ["nw_hr_salary_bands"],
      }),
      answer(),
      { liveLoopback: true },
    );
    expect(outcome.status).toBe("skipped");
    expect(outcome.skipReason).toMatch(/loopback/i);
  });

  it("scores permission questions when the question principal was applied live", () => {
    const outcome = scoreNorthwindAnswer(
      question({
        questionId: "q074",
        category: "permission",
        expectedDocumentIds: [],
        expectedSections: [],
        forbiddenDocumentIds: ["nw_hr_termination_offboarding"],
      }),
      answer({
        structuredAnswer: {
          answerType: "insufficient_evidence",
          paragraphs: [{ text: "Not enough evidence.", citations: [] }],
        },
        retrieval: {
          results: [
            {
              source: "Equipment Return",
              citationLabel: "[1]",
              documentId: "nw_operations_equipment_return",
            },
          ],
        },
      }),
    );
    expect(outcome.status).toBe("pass");
  });

  it("records live recall, uncited gold and vector degradation", () => {
    const outcome = scoreNorthwindAnswer(
      question({
        questionId: "q090",
        category: "multi_hop",
        expectedDocumentIds: ["nw_support_refund_policy", "nw_support_dsar_process"],
        expectedSections: [],
      }),
      answer({
        structuredAnswer: {
          answerType: "grounded",
          paragraphs: [{ text: "Refunds take 14 days.", citations: ["[1]"] }],
        },
        retrieval: {
          results: [
            { source: "Refunds", citationLabel: "[1]", documentId: "nw_support_refund_policy" },
            { source: "DSAR", citationLabel: "[2]", documentId: "nw_support_dsar_process" },
          ],
        },
        vectorDegradedCount: 1,
      }),
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.liveRecall).toBe(1);
    expect(outcome.goldRetrievedUncited).toEqual(["nw_support_dsar_process"]);
    expect(outcome.vectorDegradedCount).toBe(1);
  });

  it("fails permission when forbidden documents leak into retrieval", () => {
    const outcome = scoreNorthwindAnswer(
      question({
        questionId: "q066",
        category: "permission",
        expectedDocumentIds: [],
        expectedSections: [],
        forbiddenDocumentIds: ["nw_hr_salary_bands"],
      }),
      answer({
        structuredAnswer: {
          answerType: "insufficient_evidence",
          paragraphs: [{ text: "No.", citations: [] }],
        },
        retrieval: {
          results: [
            {
              source: "Salary Bands",
              citationLabel: "[1]",
              documentId: "nw_hr_salary_bands",
            },
          ],
        },
      }),
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.detail).toContain("nw_hr_salary_bands");
  });
});
