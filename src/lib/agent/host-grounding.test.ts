import { describe, expect, it } from "vitest";

import {
  BRAIN_INVALID_CITATION,
  BRAIN_KNOWLEDGE_UNAVAILABLE,
  BRAIN_MUST_RETRIEVE,
  BRAIN_NOT_ENOUGH_EVIDENCE,
  SEARCH_KNOWLEDGE_TOOL,
  buildTurnLedger,
  createLedger,
  enforceBrainGrounding,
  knowledgeToolsPresent,
  markersValidForLedger,
  type TranscriptMessage,
} from "./host-grounding";
import { BudgetTracker } from "./budgets";
import { createSearchKnowledgeTool } from "./search-knowledge";

function brainAgent(tools: string[] = [SEARCH_KNOWLEDGE_TOOL]) {
  return { profile: "brain", validToolNames: tools };
}

function hit(chunkId: string, documentId = "doc-1", version: string | null = "v1") {
  return {
    chunk_id: chunkId,
    content: "Leave accrues monthly.",
    score: 0.9,
    citation: {
      source_name: "Policy",
      section_heading: "Scope",
      chunk_id: chunkId,
      document_id: documentId,
      source_path: `/${documentId}.md`,
      version,
      effective_date: null,
    },
  };
}

function searchResult(payload: Record<string, unknown>) {
  return payload;
}

function turnWithSearch(payload: Record<string, unknown>): TranscriptMessage[] {
  return [
    { role: "user", content: "What is the leave policy?" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "tc1", type: "function", function: { name: SEARCH_KNOWLEDGE_TOOL } }],
    },
    {
      role: "tool",
      name: SEARCH_KNOWLEDGE_TOOL,
      tool_call_id: "tc1",
      content: JSON.stringify(payload),
    },
  ];
}

describe("host grounding finalizer", () => {
  it("replaces prose when retrieval never ran", () => {
    const messages: TranscriptMessage[] = [{ role: "user", content: "What is the leave policy?" }];
    const out = enforceBrainGrounding(brainAgent(), {
      finalResponse: "Employees get 20 days of leave per year.",
      messages,
    });
    expect(out).toBe(BRAIN_MUST_RETRIEVE);
    expect(out).not.toContain("20 days");
    expect(messages.at(-1)?.content).toBe(BRAIN_MUST_RETRIEVE);
  });

  it("becomes insufficient evidence on empty retrieval", () => {
    const messages = turnWithSearch(
      searchResult({ hits: [], citations: [], not_enough_evidence: true }),
    );
    const out = enforceBrainGrounding(brainAgent(), {
      finalResponse: "The policy is silent on that point, but typically…",
      messages,
    });
    expect(out).toBe(BRAIN_NOT_ENOUGH_EVIDENCE);
  });

  it("rejects a citation that is not in the current-turn ledger", () => {
    const found = hit("chunk-a");
    const messages = turnWithSearch(searchResult({ hits: [found], citations: [found.citation] }));
    const out = enforceBrainGrounding(brainAgent(), {
      finalResponse: "Leave is accrued monthly.[2]",
      messages,
    });
    expect(out).toBe(BRAIN_INVALID_CITATION);
  });

  it("passes a supported answer with a valid marker", () => {
    const found = {
      ...hit("chunk-a"),
      content: "Leave accrues monthly.",
    };
    const messages = turnWithSearch(searchResult({ hits: [found], citations: [found.citation] }));
    const prose = "Leave accrues monthly.[1]";
    expect(
      enforceBrainGrounding(brainAgent(), { finalResponse: prose, messages }),
    ).toBe(prose);
  });

  it("rejects an invented claim even when it cites an in-range marker", () => {
    const found = {
      ...hit("chunk-a"),
      content: "Employees accrue 1.5 days of leave per month.",
    };
    const messages = turnWithSearch(searchResult({ hits: [found], citations: [found.citation] }));
    expect(
      enforceBrainGrounding(brainAgent(), {
        finalResponse: "Employees accrue 20 days of leave per month.[1]",
        messages,
      }),
    ).toBe(BRAIN_INVALID_CITATION);
  });

  it("rejects citation-free prose and an uncited paragraph after successful retrieval", () => {
    const found = hit("chunk-a");
    const messages = turnWithSearch(searchResult({ hits: [found], citations: [found.citation] }));
    expect(
      enforceBrainGrounding(brainAgent(), {
        finalResponse: "Leave accrues monthly.",
        messages,
      }),
    ).toBe(BRAIN_INVALID_CITATION);
    expect(
      enforceBrainGrounding(brainAgent(), {
        finalResponse: "Leave accrues monthly.[1]\n\nIt also carries over automatically.",
        messages,
      }),
    ).toBe(BRAIN_INVALID_CITATION);
  });

  it("leaves a non-brain profile unchanged", () => {
    const prose = "Here is a general answer with no knowledge search.";
    expect(
      enforceBrainGrounding(
        { profile: "agent", validToolNames: ["terminal"] },
        { finalResponse: prose, messages: [{ role: "user", content: "hi" }] },
      ),
    ).toBe(prose);
  });

  it("uses a deterministic availability response when knowledge tools are missing", () => {
    const out = enforceBrainGrounding(brainAgent(["todo"]), {
      finalResponse: "I looked it up and the answer is 42.",
      messages: [{ role: "user", content: "policy?" }],
    });
    expect(out).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    expect(out).not.toContain("42");
    expect(out?.toLowerCase()).not.toContain("sanad");
  });

  it("replaces transport errors with the same availability response", () => {
    const messages = turnWithSearch(searchResult({ error: "connection refused" }));
    const out = enforceBrainGrounding(brainAgent(), {
      finalResponse: "According to the handbook the answer is 14 days.",
      messages,
    });
    expect(out).toBe(BRAIN_KNOWLEDGE_UNAVAILABLE);
    expect(out?.toLowerCase()).not.toContain("connection refused");
  });

  it("merges two successful searches and rejects an unknown marker", () => {
    const hitA = { ...hit("chunk-a"), content: "Alpha policy applies." };
    const hitB = { ...hit("chunk-b", "doc-2"), content: "Beta policy applies." };
    const messages: TranscriptMessage[] = [
      { role: "user", content: "multi hop?" },
      {
        role: "tool",
        name: SEARCH_KNOWLEDGE_TOOL,
        tool_call_id: "t1",
        content: JSON.stringify(searchResult({ hits: [hitA], citations: [hitA.citation] })),
      },
      {
        role: "tool",
        name: SEARCH_KNOWLEDGE_TOOL,
        tool_call_id: "t2",
        content: JSON.stringify(searchResult({ hits: [hitB], citations: [hitB.citation] })),
      },
    ];
    const ledger = buildTurnLedger(messages);
    expect(ledger.identities.map((item) => item.chunkId)).toEqual(["chunk-a", "chunk-b"]);
    expect(markersValidForLedger("Alpha policy applies.[1] Beta policy applies.[2]", ledger)).toBe(true);
    expect(markersValidForLedger("C.[3]", ledger)).toBe(false);
  });

  it("does not let a synthetic user nudge erase in-turn evidence", () => {
    const found = hit("chunk-a");
    const messages: TranscriptMessage[] = [
      { role: "user", content: "leave policy?" },
      {
        role: "tool",
        name: SEARCH_KNOWLEDGE_TOOL,
        tool_call_id: "t1",
        content: JSON.stringify(searchResult({ hits: [found], citations: [found.citation] })),
      },
      {
        role: "user",
        content: "[System: Continue now.]",
        _dropped_toolcall_nudge: true,
      },
    ];
    expect(buildTurnLedger(messages).identities.map((item) => item.chunkId)).toEqual(["chunk-a"]);
    expect(
      enforceBrainGrounding(brainAgent(), {
        finalResponse: "Leave accrues monthly.[1]",
        messages,
        rewriteTranscript: false,
      }),
    ).toBe("Leave accrues monthly.[1]");
  });

  it("rewrites the durable assistant transcript when grounding replaces prose", () => {
    const unsupported = "Employees get 20 days of leave.";
    const messages: TranscriptMessage[] = [
      { role: "user", content: "leave?" },
      { role: "assistant", content: unsupported },
    ];
    const out = enforceBrainGrounding(brainAgent(), {
      finalResponse: unsupported,
      messages,
    });
    expect(out).toBe(BRAIN_MUST_RETRIEVE);
    expect(messages.at(-1)?.content).toBe(BRAIN_MUST_RETRIEVE);
  });

  it("does not treat a look-alike payload without the tool name as retrieval", () => {
    const found = hit("chunk-a");
    const messages: TranscriptMessage[] = [
      { role: "user", content: "leave?" },
      { role: "tool", name: "other_tool", content: JSON.stringify({ hits: [found] }) },
    ];
    expect(buildTurnLedger(messages).successfulSearchCount).toBe(0);
    expect(knowledgeToolsPresent(brainAgent())).toBe(true);
  });

  it("resolves the label shown on a second search to that search's evidence", async () => {
    const ledger = createLedger();
    const budgets = new BudgetTracker();
    const tool = createSearchKnowledgeTool({
      pipeline: {
        search: async ({ query }) => {
          const alpha = query.includes("alpha");
          return {
            hits: [
              {
                chunkId: alpha ? "chunk-a" : "chunk-b",
                content: alpha ? "Alpha policy applies." : "Beta policy applies.",
                score: 1,
                citation: {
                  chunkId: alpha ? "chunk-a" : "chunk-b",
                  documentId: alpha ? "doc-1" : "doc-2",
                  sourceName: "Policy",
                  sourcePath: alpha ? "/doc-1.md" : "/doc-2.md",
                  sectionHeading: "Scope",
                  charStart: 0,
                  charEnd: 20,
                },
              },
            ],
            trace: {
              query,
              finalChunkIds: [alpha ? "chunk-a" : "chunk-b"],
              vectorScores: {},
              keywordScores: {},
              fusedScores: {},
              rerankScores: {},
              fingerprint: "test",
            },
          };
        },
      },
      principal: { userId: "support", roles: ["standard"], departments: ["support"] },
      policyPrincipal: { id: "principal-alice" },
      conversationId: "c-1",
      budgets,
      ledger,
    });
    const first = await tool.execute("t1", { query: "alpha" });
    const second = await tool.execute("t2", { query: "beta" });
    const firstText = first.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    const secondText = second.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    const firstPayload = JSON.parse(firstText.replace(/^UNTRUSTED_EVIDENCE\n/, "")) as {
      hits: Array<{ chunk_id: string; label: string }>;
    };
    const secondPayload = JSON.parse(secondText.replace(/^UNTRUSTED_EVIDENCE\n/, "")) as {
      hits: Array<{ chunk_id: string; label: string }>;
    };
    expect(firstPayload.hits[0]).toMatchObject({ chunk_id: "chunk-a", label: "[1]" });
    expect(secondPayload.hits[0]).toMatchObject({ chunk_id: "chunk-b", label: "[2]" });
    expect(budgets.toolCalls).toBe(0);
    expect(budgets.searchKnowledgeCalls).toBe(0);
    const messages: TranscriptMessage[] = [
      { role: "user", content: "multi hop?" },
      {
        role: "tool",
        name: SEARCH_KNOWLEDGE_TOOL,
        content: firstText.replace(/^UNTRUSTED_EVIDENCE\n/, ""),
      },
      {
        role: "tool",
        name: SEARCH_KNOWLEDGE_TOOL,
        content: secondText.replace(/^UNTRUSTED_EVIDENCE\n/, ""),
      },
    ];
    expect(
      enforceBrainGrounding(brainAgent(), {
        finalResponse: "Beta policy applies.[2]",
        messages,
        rewriteTranscript: false,
      }),
    ).toBe("Beta policy applies.[2]");
    expect(
      enforceBrainGrounding(brainAgent(), {
        finalResponse: "Beta policy applies.[1]",
        messages,
        rewriteTranscript: false,
      }),
    ).toBe(BRAIN_INVALID_CITATION);
  });

  it("fails closed when two searches reuse the same citation label for different chunks", () => {
    const messages: TranscriptMessage[] = [
      { role: "user", content: "multi hop?" },
      {
        role: "tool",
        name: SEARCH_KNOWLEDGE_TOOL,
        content: JSON.stringify({
          hits: [{ ...hit("chunk-a"), content: "Alpha policy applies.", label: "[1]" }],
          citations: [{ chunk_id: "chunk-a", document_id: "doc-1", label: "[1]" }],
        }),
      },
      {
        role: "tool",
        name: SEARCH_KNOWLEDGE_TOOL,
        content: JSON.stringify({
          hits: [{ ...hit("chunk-b", "doc-2"), content: "Beta policy applies.", label: "[1]" }],
          citations: [{ chunk_id: "chunk-b", document_id: "doc-2", label: "[1]" }],
        }),
      },
    ];
    expect(buildTurnLedger(messages).labelConflict).toBe(true);
    expect(
      enforceBrainGrounding(brainAgent(), {
        finalResponse: "Beta policy applies.[1]",
        messages,
        rewriteTranscript: false,
      }),
    ).toBe(BRAIN_INVALID_CITATION);
  });
});
