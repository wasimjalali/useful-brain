import { describe, expect, it } from "vitest";

import type { DocumentResponse } from "@/lib/contracts/library";
import type { GroundedAnswerResponse } from "@/lib/rag/grounded-answer";

import {
  citedPassages,
  displayNumbers,
  paragraphDisplayViews,
  highlightRanges,
  labelNumber,
  paragraphViews,
  readerFromDocument,
  readersPhrase,
  retrievedPassages,
  sourceRefs,
} from "./answer-view";
import { applyEvidenceUrl, parseEvidenceUrl } from "./evidence-url";

function result(rank: number, label: string, extra: Record<string, unknown> = {}) {
  return {
    rank,
    score: 0.9 - rank / 100,
    chunkId: `chunk_${rank}`,
    source: `doc_${rank}.md`,
    section: `Section ${rank}`,
    text: `Text of passage ${rank}.`,
    tokenEstimate: 5,
    citationLabel: label,
    documentId: `doc_${rank}`,
    ...extra,
  };
}

function answer(overrides: Partial<GroundedAnswerResponse> = {}): GroundedAnswerResponse {
  return {
    question: "q",
    answer: "a",
    answerModel: "m",
    structuredAnswer: {
      answerType: "grounded",
      paragraphs: [
        { text: "Sixteen weeks [1]. After six months [2].", citations: ["[1]", "[2]"] },
        { text: "I've prepared the ticket.", citations: [], kind: "action_note" } as never,
      ],
    },
    retrieval: {
      embeddingModel: "e",
      embeddingDimensions: 1,
      results: [
        result(1, "[1]", { documentTitle: "Parental Leave Policy", rerankScore: 0.99, keywordScore: 0.8, vectorScore: 0.7 }),
        result(2, "[2]"),
        result(3, "[3]"),
      ],
    },
    corpusGenerationId: "g-1",
    ...overrides,
  };
}

describe("labelNumber", () => {
  it("parses only well-formed bracketed numbers", () => {
    expect(labelNumber("[3]")).toBe(3);
    expect(labelNumber("3")).toBeNull();
    expect(labelNumber("[x]")).toBeNull();
    expect(labelNumber("")).toBeNull();
  });
});

describe("paragraphViews", () => {
  it("maps citation labels to numbers and keeps the action note plain", () => {
    const views = paragraphViews(answer());
    expect(views[0]).toEqual({ text: "Sixteen weeks [1]. After six months [2].", citations: [1, 2] });
    expect(views[1]).toEqual({ text: "I've prepared the ticket.", citations: [] });
  });

  it("drops a citation that is not in the evidence snapshot", () => {
    const views = paragraphViews(
      answer({
        structuredAnswer: {
          answerType: "grounded",
          paragraphs: [{ text: "Claim [9].", citations: ["[9]", "[1]", "[1]"] }],
        },
      }),
    );
    expect(views[0].citations).toEqual([1]);
  });
});

describe("sourceRefs and passages", () => {
  it("lists only cited sources, never the action note, using the catalog title", () => {
    expect(sourceRefs(answer())).toEqual([
      { n: 1, display: 1, document: "Parental Leave Policy", section: "Section 1" },
      { n: 2, display: 2, document: "doc_2.md", section: "Section 2" },
    ]);
  });

  it("builds cited passages with admin diagnostics only for admins", () => {
    const member = citedPassages(answer(), { isAdmin: false });
    expect(member).toHaveLength(2);
    expect(member[0].generation).toBeUndefined();
    expect(member[0].rerankScore).toBeUndefined();

    const admin = citedPassages(answer(), { isAdmin: true });
    expect(admin[0]).toMatchObject({
      n: 1,
      chunkId: "chunk_1",
      generation: "g-1",
      keywordScore: 0.8,
      vectorScore: 0.7,
      rerankScore: 0.99,
    });
  });

  it("marks cited rows in the retrieved list and hides scores from members", () => {
    const rows = retrievedPassages(answer(), { isAdmin: false });
    expect(rows.map((row) => [row.rank, row.cited])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
    expect(rows[0].rerankScore).toBeUndefined();
    expect(retrievedPassages(answer(), { isAdmin: true })[0].rerankScore).toBe(0.99);
  });

  it("returns nothing for an answer without evidence", () => {
    const empty = answer({
      structuredAnswer: { answerType: "insufficient_evidence", paragraphs: [] },
      retrieval: { embeddingModel: "e", embeddingDimensions: 1, results: [] },
    });
    expect(sourceRefs(empty)).toEqual([]);
    expect(citedPassages(empty, { isAdmin: false })).toEqual([]);
  });
});

describe("highlightRanges", () => {
  const chunk = "Eligible employees receive sixteen weeks of fully paid leave. Office hours are nine to five.";

  it("marks the sentence the answer relied on", () => {
    const ranges = highlightRanges(chunk, ["You get sixteen weeks of fully paid parental leave per child [1]."]);
    expect(ranges).toHaveLength(1);
    expect(chunk.slice(ranges[0].start, ranges[0].end)).toBe(
      "Eligible employees receive sixteen weeks of fully paid leave.",
    );
  });

  it("marks nothing when no sentence overlaps", () => {
    expect(highlightRanges(chunk, ["Completely different subject entirely."])).toEqual([]);
  });

  it("marks nothing for empty input", () => {
    expect(highlightRanges("", ["x"])).toEqual([]);
    expect(highlightRanges(chunk, [])).toEqual([]);
  });
});

describe("readersPhrase", () => {
  it("names who can read in plain words", () => {
    expect(readersPhrase({ kind: "departments", names: ["HR"] })).toBe("HR");
    expect(readersPhrase({ kind: "departments", names: ["HR", "Finance"] })).toBe("HR and Finance");
    expect(readersPhrase({ kind: "roles", names: ["Managers", "Directors", "HR managers"] })).toBe(
      "Managers, Directors and HR managers",
    );
    expect(readersPhrase({ kind: "everyone", names: [] })).toBe("everyone");
    expect(readersPhrase({ kind: "private", names: [] })).toBe("its owner");
  });
});

describe("readerFromDocument", () => {
  const doc: DocumentResponse = {
    id: "nw_hr_parental_leave",
    title: "Parental Leave Policy",
    version: "2.0",
    effectiveDate: "2026-02-01",
    ownerDepartment: "HR",
    readers: { kind: "everyone", names: [] },
    sections: [
      { heading: "Paid Leave", text: "Intro line.\n\nSixteen weeks of paid leave. Second sentence." },
      { heading: "Eligibility", text: "After six months." },
    ],
    spans: [
      { section: 0, start: 13, end: 41, citation: "[1]", active: true },
      { section: 1, start: 0, end: 17, citation: "[2]", active: false },
    ],
  };

  it("formats metadata and finds the active citation", () => {
    const { view, activeN } = readerFromDocument(doc);
    expect(view).toMatchObject({
      title: "Parental Leave Policy",
      version: "2.0",
      effective: "1 Feb 2026",
      owner: "HR",
      readableBy: { label: "Everyone", everyone: true },
    });
    expect(activeN).toBe(1);
  });

  it("splits paragraphs and highlights spans in place", () => {
    const { view } = readerFromDocument(doc);
    expect(view.sections[0].paragraphs).toEqual([
      [{ text: "Intro line." }],
      [{ text: "Sixteen weeks of paid leave." , citation: 1 }, { text: " Second sentence." }],
    ]);
    expect(view.sections[1].paragraphs).toEqual([[{ text: "After six months.", citation: 2 }]]);
  });

  it("shows the whole body when there are no spans and tolerates missing metadata", () => {
    const { view, activeN } = readerFromDocument({
      ...doc,
      version: null,
      effectiveDate: null,
      ownerDepartment: null,
      readers: { kind: "departments", names: ["HR", "Finance"] },
      spans: undefined,
    });
    expect(activeN).toBeNull();
    expect(view.version).toBe("Not set");
    expect(view.effective).toBe("Not set");
    expect(view.owner).toBe("Not set");
    expect(view.readableBy).toEqual({ label: "HR, Finance", everyone: false });
    expect(view.sections[0].paragraphs[1]).toEqual([{ text: "Sixteen weeks of paid leave. Second sentence." }]);
  });

  it("clamps a span that runs past the section text", () => {
    const { view } = readerFromDocument({
      ...doc,
      sections: [{ heading: "H", text: "Short." }],
      spans: [{ section: 0, start: 2, end: 999, citation: "[1]", active: true }],
    });
    expect(view.sections[0].paragraphs).toEqual([[{ text: "Sh" }, { text: "ort.", citation: 1 }]]);
  });
});

describe("evidence url state", () => {
  it("reads evidence, doc and citation", () => {
    expect(parseEvidenceUrl(new URLSearchParams("evidence=retrieved&doc=nw_x&c=2"))).toEqual({
      evidence: "retrieved",
      doc: "nw_x",
      c: 2,
    });
  });

  it("rejects unknown tabs and bad citation numbers", () => {
    expect(parseEvidenceUrl(new URLSearchParams("evidence=bogus&c=0"))).toEqual({
      evidence: null,
      doc: null,
      c: null,
    });
    expect(parseEvidenceUrl(new URLSearchParams("c=abc"))).toMatchObject({ c: null });
  });

  it("writes our keys and keeps every other param", () => {
    expect(applyEvidenceUrl("?settings=1", { evidence: "cited", doc: "nw_x", c: 1 })).toBe(
      "settings=1&evidence=cited&doc=nw_x&c=1",
    );
    expect(applyEvidenceUrl("?settings=1&evidence=cited&doc=a&c=2", { evidence: null, doc: null, c: null })).toBe(
      "settings=1",
    );
  });
});

describe("display numbers", () => {
  const sparse = answer({
    structuredAnswer: {
      answerType: "grounded",
      paragraphs: [{ text: "Late rank first [3]. Then [1].", citations: ["[1]", "[3]"] }],
    },
  });

  it("numbers cited sources 1, 2 in order of first citation and keeps retrieval ranks", () => {
    expect([...displayNumbers(sparse)]).toEqual([
      [3, 1],
      [1, 2],
    ]);
    expect(paragraphDisplayViews(sparse)[0].display).toEqual({ 3: 1, 1: 2 });
    expect(sourceRefs(sparse).map((s) => [s.n, s.display])).toEqual([
      [3, 1],
      [1, 2],
    ]);
    expect(citedPassages(sparse, { isAdmin: false }).map((p) => [p.n, p.display])).toEqual([
      [3, 1],
      [1, 2],
    ]);
    expect(retrievedPassages(sparse, { isAdmin: false }).map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("gives the reader's span chip the same display number", () => {
    const { view } = readerFromDocument(
      {
        id: "d",
        title: "T",
        version: null,
        effectiveDate: null,
        ownerDepartment: "hr",
        readers: { kind: "everyone", names: [] },
        sections: [{ heading: "H", text: "Alpha beta." }],
        spans: [{ section: 0, start: 0, end: 5, citation: "[3]", active: true }],
      } as never,
      displayNumbers(sparse),
    );
    expect(view.sections[0].paragraphs[0][0]).toMatchObject({ citation: 3, display: 1 });
    expect(view.owner).toBe("HR");
  });
});
