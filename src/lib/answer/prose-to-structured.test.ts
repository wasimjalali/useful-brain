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

  it("completes citations for every evidence item that states the copied sentence", () => {
    const twinEvidence = addCitationLabels([
      evidence[0],
      {
        rank: 2,
        score: 0.8,
        chunkId: "handbook__body__004",
        source: "employee-handbook.md",
        section: "Time Off",
        text: "Employees accrue 1.5 days of leave per month. See the leave policy for details.",
        tokenEstimate: 20,
      },
    ]);
    expect(
      structuredAnswerFromGroundedProse(
        "Employees accrue 1.5 days of leave per month.[1]",
        twinEvidence,
      ).paragraphs[0].citations,
    ).toEqual(["[1]", "[2]"]);
  });
});
