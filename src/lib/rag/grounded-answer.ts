export type CitedRetrievalResult = {
  rank: number;
  score: number;
  chunkId: string;
  source: string;
  section: string;
  text: string;
  tokenEstimate: number;
  citationLabel: string;
  documentId?: string | null;
  vectorScore?: number | null;
  keywordScore?: number | null;
  fusedScore?: number | null;
  rerankScore?: number | null;
};

export type GroundedAnswerParagraph = {
  text: string;
  citations: string[];
};

export type StructuredGroundedAnswer = {
  answerType: "grounded" | "insufficient_evidence";
  paragraphs: GroundedAnswerParagraph[];
};

export type GroundedAnswerResponse = {
  question: string;
  answer: string;
  answerModel: string;
  structuredAnswer: StructuredGroundedAnswer;
  retrieval: {
    embeddingModel: string;
    embeddingDimensions: number;
    results: CitedRetrievalResult[];
  };
  conversationId?: string;
  assistantMessageId?: string;
  corpusGenerationId?: string | null;
  retrievalConfigVersion?: string | null;
  promptVersion?: string;
  /** Searches this turn whose vector channel failed and ran keyword-only. */
  vectorDegradedCount?: number;
  /** Why an insufficient-evidence answer was kept despite retrieved evidence. */
  refusalReason?: string;
  /** Loopback-only retrieval principal this turn was scoped to, when assumed. */
  assumedPrincipal?: { userId: string; roles: string[]; departments: string[] };
};
