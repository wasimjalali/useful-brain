import { describe, expect, it } from "vitest";

import {
  BRAIN_INVALID_CITATION,
  BRAIN_KNOWLEDGE_UNAVAILABLE,
  BRAIN_MUST_RETRIEVE,
  BRAIN_NOT_ENOUGH_EVIDENCE,
  SEARCH_KNOWLEDGE_TOOL,
  buildTurnLedger,
  enforceBrainGrounding,
  knowledgeToolsPresent,
  markersValidForLedger,
  type TranscriptMessage,
} from "./host-grounding";

function brainAgent(tools: string[] = [SEARCH_KNOWLEDGE_TOOL]) {
  return { profile: "brain", validToolNames: tools };
}

function hit(chunkId: string, documentId = "doc-1", version: string | null = "v1") {
  return {
    chunk_id: chunkId,
    content: `body of ${chunkId}`,
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
    const found = hit("chunk-a");
    const messages = turnWithSearch(searchResult({ hits: [found], citations: [found.citation] }));
    const prose = "Leave accrues monthly.[1]";
    expect(
      enforceBrainGrounding(brainAgent(), { finalResponse: prose, messages }),
    ).toBe(prose);
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
    const hitA = hit("chunk-a");
    const hitB = hit("chunk-b", "doc-2");
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
    expect(markersValidForLedger("A.[1] B.[2]", ledger)).toBe(true);
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
});
