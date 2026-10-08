/** View-model types for the chat answer and evidence components. Presentational only. */

/** A validated paragraph. `citations` are the validated citation numbers for this paragraph. */
export type AnswerParagraphView = {
  text: string;
  citations: number[];
  /** Citation number to the number its chip shows (order of first citation). */
  display?: Record<number, number>;
};

export type SourceRefView = {
  n: number;
  /** Shown number. `n` stays the key. */
  display?: number;
  document: string;
  section: string;
};

export type SuggestionView = {
  question: string;
  department: string;
};

export type ChatProgressView =
  | { kind: "searching"; readableDocuments: number }
  | { kind: "reading"; passages: number }
  | { kind: "writing"; passages?: number };

export type FeedbackValue = "up" | "down";

/** Character range inside a passage that the answer relied on. */
export type HighlightRange = { start: number; end: number };

export type CitedPassageView = {
  n: number;
  /** Shown number. `n` stays the key. */
  display?: number;
  chunkId: string;
  document: string;
  section: string;
  text: string;
  highlights?: HighlightRange[];
  /** Admin-only diagnostics. */
  generation?: string;
  keywordScore?: number | null;
  vectorScore?: number | null;
  rerankScore?: number | null;
};

export type RetrievedPassageView = {
  rank: number;
  chunkId: string;
  document: string;
  section: string;
  cited: boolean;
  /** Admin-only. */
  rerankScore?: number | null;
};

export type EvidenceTab = "cited" | "retrieved";

export type ReaderSegmentView = {
  text: string;
  /** Present when this span is the passage a citation relied on. */
  citation?: number;
  /** Shown number for `citation`. */
  display?: number;
};

export type ReaderSectionView = {
  heading: string;
  paragraphs: ReaderSegmentView[][];
};

export type ReaderDocumentView = {
  title: string;
  version: string;
  effective: string;
  readableBy: { label: string; everyone: boolean };
  owner: string;
  sections: ReaderSectionView[];
};

export type ApprovalView =
  | { status: "pending"; tool: string; args: Array<[key: string, value: string]> }
  | {
      status: "done";
      ticketId: string;
      priority: string;
      customer: string;
      subject: string;
      createdAt: number;
    }
  | { status: "denied" }
  | { status: "expired" };
