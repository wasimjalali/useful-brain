import { describe, expect, it, vi } from "vitest";

import type { CitedRetrievalResult } from "../answer/contract";
import { createWorkersAiCitationRepair } from "./workers-ai-citation-repair";
import { CHAT_MODEL_ID } from "./selection";

const evidence: CitedRetrievalResult[] = [
  {
    rank: 1,
    score: 0.3,
    chunkId: "support-sla__targets__001",
    source: "support-sla-policy.md",
    section: "Response and Resolution Targets",
    text: "P1 tickets have a first-response target of 1 hour.",
    tokenEstimate: 12,
    citationLabel: "[1]",
    documentId: "support-sla-policy",
  },
];

describe("Workers AI citation repair", () => {
  it("returns only a strictly validated cited answer", async () => {
    const run = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              quotes: [
                {
                  quote: "P1 tickets have a first-response target of 1 hour.",
                  citation: "[1]",
                },
              ],
            }),
          },
        },
      ],
    });
    const repair = createWorkersAiCitationRepair({ run });

    await expect(
      repair({
        question: "What is the first-response target for a P1 support ticket?",
        evidence,
      }),
    ).resolves.toBe("P1 tickets have a first-response target of 1 hour. [1]");
    expect(run).toHaveBeenCalledWith(
      CHAT_MODEL_ID,
      expect.objectContaining({
        stream: false,
        temperature: 0,
        max_completion_tokens: 512,
      }),
    );
  });

  it("fails closed when the repaired claim is not supported", async () => {
    const run = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              quotes: [
                {
                  quote: "P1 tickets have a first-response target of 15 minutes.",
                  citation: "[1]",
                },
              ],
            }),
          },
        },
      ],
    });
    const repair = createWorkersAiCitationRepair({ run });

    await expect(repair({ question: "What is the holiday allowance?", evidence })).resolves.toBeNull();
  });

  it("falls back to a relevant exact evidence sentence", async () => {
    const run = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify({ quotes: [] }) },
        },
      ],
    });
    const repair = createWorkersAiCitationRepair({ run });

    await expect(
      repair({
        question: "What is the refund window for an annual plan?",
        evidence: [
          {
            ...evidence[0],
            text: "For annual plans, a customer may request a refund within 14 calendar days of the invoice date. For monthly plans, the window is 7 calendar days.",
          },
        ],
      }),
    ).resolves.toBe(
      "For annual plans, a customer may request a refund within 14 calendar days of the invoice date. [1]",
    );
  });

  it("never repairs or extracts a prohibited health claim", async () => {
    const run = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              quotes: [
                {
                  quote: "This supplement cures headaches.",
                  citation: "[1]",
                },
              ],
            }),
          },
        },
      ],
    });
    const repair = createWorkersAiCitationRepair({ run });

    await expect(
      repair({
        question: "Can this supplement cure my headaches?",
        evidence: [{ ...evidence[0], text: "This supplement cures headaches." }],
      }),
    ).resolves.toBeNull();
  });
});
