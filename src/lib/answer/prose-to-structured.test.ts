import { describe, expect, it } from "vitest";

import { BRAIN_NOT_ENOUGH_EVIDENCE } from "../agent/host-grounding";
import { addCitationLabels } from "./contract";
import { structuredAnswerFromGroundedProse } from "./prose-to-structured";

const evidence = addCitationLabels([
  {
    rank: 1,
    score: 0.9,
    chunkId: "leave-policy__body__000",
    source: "leave-and-time-off-policy.md",
    section: "Accrual",
    text: "Employees accrue 1.5 days of leave per month.",
    tokenEstimate: 12,
  },
]);

describe("structuredAnswerFromGroundedProse", () => {
  it("converts cited prose into grounded JSON paragraphs", () => {
    expect(
      structuredAnswerFromGroundedProse("Employees accrue 1.5 days of leave per month.[1]", evidence),
    ).toEqual({
      answerType: "grounded",
      paragraphs: [
        {
          text: "Employees accrue 1.5 days of leave per month.",
          citations: ["[1]"],
        },
      ],
    });
  });

  it("returns insufficient evidence for host refusal strings", () => {
    expect(structuredAnswerFromGroundedProse(BRAIN_NOT_ENOUGH_EVIDENCE, evidence).answerType).toBe(
      "insufficient_evidence",
    );
  });

  it("passes through already-structured JSON", () => {
    const raw = JSON.stringify({
      answerType: "grounded",
      paragraphs: [{ text: "Employees accrue 1.5 days of leave per month.", citations: ["[1]"] }],
    });
    expect(structuredAnswerFromGroundedProse(raw, evidence).answerType).toBe("grounded");
  });
});
