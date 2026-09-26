import { describe, expect, it, vi } from "vitest";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";

import type { CitedRetrievalResult } from "../answer/contract";
import { BudgetExceededError } from "../agent/budgets";
import { SEARCH_KNOWLEDGE_TOOL } from "../agent/host-grounding";
import { runKnowledgeAgent } from "../agent/run";
import { FakeEmbeddingProvider } from "../retrieve/fake-embed";
import { MemoryChunkStore } from "../retrieve/memory-store";
import { KnowledgePipeline } from "../retrieve/pipeline";
import {
  createWorkersAiCitationRepair,
  createWorkersAiCoveragePass,
} from "./workers-ai-citation-repair";
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
        seed: 7,
        max_completion_tokens: 1024,
        chat_template_kwargs: { enable_thinking: false },
      }),
      { signal: undefined },
    );
  });

  it("forwards the abort signal into the ai.run options", async () => {
    const controller = new AbortController();
    const seen: Array<{ signal?: AbortSignal } | undefined> = [];
    const run = vi.fn().mockImplementation(async (_model, _input, options) => {
      seen.push(options);
      return {
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
      };
    });
    const repair = createWorkersAiCitationRepair({ run });

    await expect(
      repair({
        question: "What is the first-response target for a P1 support ticket?",
        evidence,
        signal: controller.signal,
      }),
    ).resolves.toBe("P1 tickets have a first-response target of 1 hour. [1]");
    expect(seen[0]?.signal).toBe(controller.signal);
  });

  it("rejects when the signal aborts during the repair call", async () => {
    const controller = new AbortController();
    const run = vi.fn().mockImplementation(async () => {
      controller.abort();
      return {
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
      };
    });
    const repair = createWorkersAiCitationRepair({ run });

    await expect(
      repair({
        question: "What is the first-response target for a P1 support ticket?",
        evidence,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects without calling the model when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn();
    const repair = createWorkersAiCitationRepair({ run });

    await expect(
      repair({
        question: "What is the first-response target for a P1 support ticket?",
        evidence,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(run).not.toHaveBeenCalled();
  });

  it("forwards the abort signal into the coverage run options", async () => {
    const controller = new AbortController();
    const seen: Array<{ signal?: AbortSignal } | undefined> = [];
    const run = vi.fn().mockImplementation(async (_model, _input, options) => {
      seen.push(options);
      return {
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify({ quotes: [] }) },
          },
        ],
      };
    });
    const cover = createWorkersAiCoveragePass({ run });

    await expect(
      cover({
        question: "What is the P1 response target?",
        draft: "P1 tickets have a first-response target of 1 hour.[1]",
        evidence,
        signal: controller.signal,
      }),
    ).resolves.toBeNull();
    expect(seen[0]?.signal).toBe(controller.signal);
  });

  it("rejects when the signal aborts during the coverage call", async () => {
    const controller = new AbortController();
    const run = vi.fn().mockImplementation(async () => {
      controller.abort();
      return {
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify({ quotes: [] }) },
          },
        ],
      };
    });
    const cover = createWorkersAiCoveragePass({ run });

    await expect(
      cover({
        question: "What is the P1 response target?",
        draft: "P1 tickets have a first-response target of 1 hour.[1]",
        evidence,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
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

  it("covers a missing part with a verbatim quote and drops quotes already in the draft", async () => {
    const twoDocEvidence: CitedRetrievalResult[] = [
      evidence[0],
      {
        ...evidence[0],
        rank: 2,
        chunkId: "escalation__owners__001",
        source: "complaint-escalation.md",
        section: "ESC-3: VP Support",
        text: "ESC-3 complaints are owned by the VP of Support.",
        citationLabel: "[2]",
        documentId: "complaint-escalation",
      },
    ];
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
                {
                  quote: "ESC-3 complaints are owned by the VP of Support.",
                  citation: "[2]",
                },
              ],
            }),
          },
        },
      ],
    });
    const cover = createWorkersAiCoveragePass({ run });

    await expect(
      cover({
        question: "What is the P1 response target and who owns ESC-3 complaints?",
        draft: "P1 tickets have a first-response target of 1 hour.[1]",
        evidence: twoDocEvidence,
      }),
    ).resolves.toBe("ESC-3 complaints are owned by the VP of Support. [2]");
    expect(run).toHaveBeenCalledWith(
      CHAT_MODEL_ID,
      expect.objectContaining({ stream: false, temperature: 0 }),
      { signal: undefined },
    );
  });

  it("recovers the quotes object when the model narrates before the JSON", async () => {
    const run = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content:
              'The draft misses the target. So output: {"quotes":[{"quote":"a mid-reasoning example that is not the answer","citation":"[9]"}]}\n\nLet me verify the exact text. Return JSON only.</think>{"quotes":[{"quote":"P1 tickets have a first-response target of 1 hour.","citation":"[1]"}]}',
          },
        },
      ],
    });
    const cover = createWorkersAiCoveragePass({ run });

    await expect(
      cover({
        question: "What is the P1 response target and the escalation owner?",
        draft: "Something unrelated.[1]",
        evidence,
      }),
    ).resolves.toBe("P1 tickets have a first-response target of 1 hour. [1]");
  });

  it("returns no coverage additions for non-verbatim quotes", async () => {
    const run = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              quotes: [
                { quote: "P1 tickets are answered within 60 minutes.", citation: "[1]" },
              ],
            }),
          },
        },
      ],
    });
    const cover = createWorkersAiCoveragePass({ run });

    await expect(
      cover({
        question: "What is the P1 response target and who owns ESC-3 complaints?",
        draft: "Something else entirely.[1]",
        evidence,
      }),
    ).resolves.toBeNull();
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

const identifierEvidence: CitedRetrievalResult[] = [
  {
    rank: 1,
    score: 0.3,
    chunkId: "error-codes__body__001",
    source: "error-codes.md",
    section: "Export Errors",
    text: "Export stalls page the on-call engineer. ERR-7702 means the export queue is stalled.",
    tokenEstimate: 16,
    citationLabel: "[1]",
    documentId: "error-codes",
  },
];

const twoDocumentEvidence: CitedRetrievalResult[] = [
  evidence[0],
  {
    ...evidence[0],
    rank: 2,
    chunkId: "escalation__owners__001",
    source: "complaint-escalation.md",
    section: "ESC-3: VP Support",
    text: "ESC-3 complaints are owned by the VP of Support.",
    citationLabel: "[2]",
    documentId: "complaint-escalation",
  },
];

function quotesResponse(quotes: Array<{ quote: string; citation: string }>) {
  return {
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify({ quotes }) },
      },
    ],
  };
}

describe("run-local extraction reuse", () => {
  it("reuses one extraction across a strict rejection and a non-lexical abstention recheck", async () => {
    const run = vi.fn().mockResolvedValue(
      quotesResponse([
        { quote: "Export stalls page the on-call engineer.", citation: "[1]" },
      ]),
    );
    const repair = createWorkersAiCitationRepair({ run });
    const extractionCache = new Map<string, unknown>();
    const noteModelCall = vi.fn();
    const question = "What does error code ERR-7702 indicate?";

    // The strict pass rejects the quote for missing the identifier; the
    // abstention recheck applies no token filter to the same extraction and
    // accepts it. Both reads come from one provider call.
    await expect(
      repair({
        question,
        evidence: identifierEvidence,
        strictTokens: ["ERR-7702"],
        extractionCache,
        noteModelCall,
      }),
    ).resolves.toBeNull();
    await expect(
      repair({
        question,
        evidence: identifierEvidence,
        lexicalFallback: false,
        extractionCache,
        noteModelCall,
      }),
    ).resolves.toBe("Export stalls page the on-call engineer. [1]");
    expect(run).toHaveBeenCalledTimes(1);
    expect(noteModelCall).toHaveBeenCalledTimes(1);
  });

  it("applies the lexical fallback to a reused empty-quotes extraction", async () => {
    const run = vi.fn().mockResolvedValue(quotesResponse([]));
    const repair = createWorkersAiCitationRepair({ run });
    const extractionCache = new Map<string, unknown>();
    const fallbackEvidence: CitedRetrievalResult[] = [
      {
        ...evidence[0],
        text: "For annual plans, a customer may request a refund within 14 calendar days of the invoice date. For monthly plans, the window is 7 calendar days.",
      },
    ];
    const input = {
      question: "What is the refund window for an annual plan?",
      evidence: fallbackEvidence,
      extractionCache,
    };
    const expected =
      "For annual plans, a customer may request a refund within 14 calendar days of the invoice date. [1]";

    await expect(repair(input)).resolves.toBe(expected);
    await expect(repair(input)).resolves.toBe(expected);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("treats malformed JSON as a valid extraction and serves retries from it", async () => {
    const run = vi.fn().mockResolvedValue({
      choices: [
        { finish_reason: "stop", message: { content: "the answer, without any JSON" } },
      ],
    });
    const repair = createWorkersAiCitationRepair({ run });
    const extractionCache = new Map<string, unknown>();

    await expect(
      repair({
        question: "What does error code ERR-7702 indicate?",
        evidence: identifierEvidence,
        lexicalFallback: false,
        extractionCache,
      }),
    ).resolves.toBeNull();
    await expect(
      repair({
        question: "What does error code ERR-7702 indicate?",
        evidence: identifierEvidence,
        lexicalFallback: false,
        extractionCache,
      }),
    ).resolves.toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never caches a provider failure", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("workers ai unavailable"))
      .mockResolvedValue(
        quotesResponse([
          { quote: "Export stalls page the on-call engineer.", citation: "[1]" },
        ]),
      );
    const repair = createWorkersAiCitationRepair({ run });
    const extractionCache = new Map<string, unknown>();

    await expect(
      repair({
        question: "What does error code ERR-7702 indicate?",
        evidence: identifierEvidence,
        lexicalFallback: false,
        extractionCache,
      }),
    ).rejects.toThrow("workers ai unavailable");
    await expect(
      repair({
        question: "What does error code ERR-7702 indicate?",
        evidence: identifierEvidence,
        lexicalFallback: false,
        extractionCache,
      }),
    ).resolves.toBe("Export stalls page the on-call engineer. [1]");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("misses the cache when the evidence order changes", async () => {
    const run = vi.fn().mockResolvedValue(quotesResponse([]));
    const repair = createWorkersAiCitationRepair({ run });
    const extractionCache = new Map<string, unknown>();
    const question = "What is the P1 response target and who owns ESC-3 complaints?";

    await repair({ question, evidence: twoDocumentEvidence, lexicalFallback: false, extractionCache });
    await repair({
      question,
      evidence: [...twoDocumentEvidence].reverse(),
      lexicalFallback: false,
      extractionCache,
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not cache an extraction aborted mid-request", async () => {
    const first = new AbortController();
    const run = vi
      .fn()
      .mockImplementationOnce(async () => {
        first.abort();
        return quotesResponse([
          { quote: "Export stalls page the on-call engineer.", citation: "[1]" },
        ]);
      })
      .mockResolvedValue(
        quotesResponse([
          { quote: "Export stalls page the on-call engineer.", citation: "[1]" },
        ]),
      );
    const repair = createWorkersAiCitationRepair({ run });
    const extractionCache = new Map<string, unknown>();

    await expect(
      repair({
        question: "What does error code ERR-7702 indicate?",
        evidence: identifierEvidence,
        signal: first.signal,
        lexicalFallback: false,
        extractionCache,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      repair({
        question: "What does error code ERR-7702 indicate?",
        evidence: identifierEvidence,
        lexicalFallback: false,
        extractionCache,
      }),
    ).resolves.toBe("Export stalls page the on-call engineer. [1]");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("lets the host budget callback stop a provider call before it starts", async () => {
    const run = vi.fn();
    const repair = createWorkersAiCitationRepair({ run });

    await expect(
      repair({
        question: "What does error code ERR-7702 indicate?",
        evidence: identifierEvidence,
        extractionCache: new Map<string, unknown>(),
        noteModelCall: () => {
          throw new BudgetExceededError("TURN_LIMIT", "turn budget exhausted");
        },
      }),
    ).rejects.toThrow("turn budget exhausted");
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps the extraction cache isolated between agent runs", async () => {
    const store = new MemoryChunkStore();
    const embedder = new FakeEmbeddingProvider(8);
    const text = "Employees accrue 1.5 days of leave per month.";
    const embeddings = await embedder.embedTexts([text]);
    store.upsert([
      {
        chunkId: "leave-policy__body__000",
        documentId: "leave-policy",
        title: "Leave Policy",
        sourceName: "Leave Policy",
        sourcePath: "leave-policy.md",
        sectionHeading: "Leave",
        content: text,
        chunkIndex: 0,
        charStart: 0,
        charEnd: text.length,
        accessScope: "public",
        allowedRoles: [],
        allowedDepartments: [],
        ownerUserId: "",
        embedding: embeddings[0],
      },
    ]);
    const pipeline = new KnowledgePipeline({ store, embedder });
    const faux = fauxProvider({ provider: "useful-brain-run-isolation" });
    const run = vi.fn().mockResolvedValue(
      quotesResponse([
        { quote: "Employees accrue 1.5 days of leave per month.", citation: "[1]" },
      ]),
    );
    const runTurn = () => {
      faux.setResponses([
        fauxAssistantMessage(
          [fauxText("Searching."), fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: "leave" })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage([fauxText("Staff members gain 1.5 leave days every month.")], {
          stopReason: "stop",
        }),
      ]);
      return runKnowledgeAgent({
        question: "How much leave accrues each month?",
        pipeline,
        principal: { userId: "support", roles: ["standard"], departments: ["support"] },
        policyPrincipal: { id: "principal-alice" },
        conversationId: "c-run-isolation",
        runtime: {
          model: { ...faux.getModel(), api: "openai-completions" },
          stream: (model, context, options) =>
            faux.provider.streamSimple(model, context, options),
          repairGroundedAnswer: createWorkersAiCitationRepair({ run }),
        },
      });
    };

    const first = await runTurn();
    const second = await runTurn();

    // A shared or global cache would serve the second run's identical repair
    // request without a provider call; a run-local cache must not.
    expect(run).toHaveBeenCalledTimes(2);
    expect(first.finalResponse).toContain("Employees accrue 1.5 days of leave per month.");
    expect(second.finalResponse).toContain("Employees accrue 1.5 days of leave per month.");
  }, 20_000);
});
