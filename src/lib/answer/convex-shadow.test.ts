import { describe, expect, it } from "vitest";

import {
  addCitationLabels,
  buildGroundedAnswerMessages,
  formatEvidenceForPrompt,
  parseStructuredGroundedAnswer,
  structuredAnswerToText,
} from "../../../convex/groundedAnswer";
import * as target from "./contract";

const retrievalResults = [
  {
    rank: 1,
    score: 0.7072184,
    chunkId: "return_policy__chunk_002",
    source: "return_policy.md",
    section: "Standard Return Window",
    text: "Opened products may be returned within 30 days when the customer tried the product and is unsatisfied.",
    tokenEstimate: 42,
  },
  {
    rank: 2,
    score: 0.5128461,
    chunkId: "return_policy__chunk_004",
    source: "return_policy.md",
    section: "Non-Returnable Orders",
    text: "Final-sale bundles are not eligible for standard returns.",
    tokenEstimate: 24,
  },
];

const fixtures = [
  JSON.stringify({
    answerType: "grounded",
    paragraphs: [{ text: "Opened products may be returned within 30 days.", citations: ["[1]"] }],
  }),
  JSON.stringify({
    answerType: "grounded",
    paragraphs: [{ text: "Opened products may be returned.", citations: ["[9]"] }],
  }),
  JSON.stringify({
    answerType: "grounded",
    paragraphs: [
      { text: "Opened products may be returned within 30 days.", citations: ["[1]"] },
      { text: "The documents do not mention gift returns.", citations: [] },
    ],
  }),
  JSON.stringify({
    answerType: "grounded",
    paragraphs: [
      {
        text: "Opened products may be returned. Final-sale bundles are not eligible for standard returns.",
        citations: ["[1, 2]"],
      },
    ],
  }),
  JSON.stringify({
    answerType: "grounded",
    paragraphs: [{ text: "The policy includes a 42 percent benefit.", citations: ["[1]"] }],
  }),
  JSON.stringify({
    answerType: "insufficient_evidence",
    paragraphs: [{ text: "The policy definitely allows 60 days.", citations: ["[1]"] }],
  }),
  "not json",
  "```json\n" +
    JSON.stringify({
      answerType: "grounded",
      paragraphs: [{ text: "Opened products may be returned within 30 days.", citations: ["[1]"] }],
    }) +
    "\n```",
];

describe("Convex shadow parity", () => {
  it("matches the live Convex parser on shared fixtures", () => {
    const evidence = addCitationLabels(retrievalResults);
    const targetEvidence = target.addCitationLabels(retrievalResults);
    for (const raw of fixtures) {
      expect(target.parseStructuredGroundedAnswer(raw, targetEvidence)).toEqual(
        parseStructuredGroundedAnswer(raw, evidence),
      );
    }
  });

  it("matches Convex prompt evidence formatting and readable text", () => {
    const evidence = addCitationLabels(retrievalResults);
    const targetEvidence = target.addCitationLabels(retrievalResults);
    expect(target.formatEvidenceForPrompt(targetEvidence)).toEqual(formatEvidenceForPrompt(evidence));
    const answer = {
      answerType: "grounded" as const,
      paragraphs: [{ text: "Opened products may be returned within 30 days.", citations: ["[1]"] }],
    };
    expect(target.structuredAnswerToText(answer)).toEqual(structuredAnswerToText(answer));
    expect(target.buildGroundedAnswerMessages("q", targetEvidence)[0].role).toBe(
      buildGroundedAnswerMessages("q", evidence)[0].role,
    );
  });
});
