import { ABSTENTION_CATEGORIES, type EvalQuestion } from "./northwind-loader";

export type NorthwindAnswerForEval = {
  answer: string;
  structuredAnswer: {
    answerType: "grounded" | "insufficient_evidence";
    paragraphs: Array<{ text: string; citations: string[] }>;
  };
  retrieval: {
    results: Array<{
      source: string;
      section?: string;
      citationLabel: string;
      documentId?: string | null;
    }>;
  };
  vectorDegradedCount?: number;
  refusalReason?: string;
};

export type NorthwindAnswerScore = {
  questionId: string;
  category: EvalQuestion["category"];
  status: "pass" | "fail" | "skipped";
  skipReason?: string;
  detail: string;
  answerType: string;
  citedDocumentIds: string[];
  retrievedDocumentIds: string[];
  sectionHit: boolean | null;
  /** Fraction of expected documents present in retrievedEvidence; null for abstention categories. */
  liveRecall: number | null;
  /** Expected documents that were retrieved this turn but never cited. */
  goldRetrievedUncited: string[];
  /** Searches this turn whose vector channel degraded to keyword-only. */
  vectorDegradedCount: number;
  refusalReason?: string;
};

const LOOPBACK_SKIP =
  "Live loopback principal is operator across all departments; ACL cases run on the retrieval layer with the question principal.";

export function citedDocumentIds(answer: NorthwindAnswerForEval): string[] {
  const byLabel = new Map(
    answer.retrieval.results.map((result) => [result.citationLabel, result.documentId ?? ""]),
  );
  const ids = new Set<string>();
  for (const paragraph of answer.structuredAnswer.paragraphs) {
    for (const label of paragraph.citations) {
      const documentId = byLabel.get(label);
      if (documentId) {
        ids.add(documentId);
      }
    }
  }
  return [...ids];
}

export function retrievedDocumentIds(answer: NorthwindAnswerForEval): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const result of answer.retrieval.results) {
    const documentId = result.documentId ?? "";
    if (!documentId || seen.has(documentId)) {
      continue;
    }
    seen.add(documentId);
    ids.push(documentId);
  }
  return ids;
}

/**
 * Score a live grounded-answer payload against a Northwind gold label.
 * Permission questions are skipped on the live loopback chat path; they are
 * scored by `runRetrievalEvals` with the question's principal instead.
 */
export function scoreNorthwindAnswer(
  question: EvalQuestion,
  answer: NorthwindAnswerForEval,
  options: { liveLoopback?: boolean } = {},
): NorthwindAnswerScore {
  const answerType = answer.structuredAnswer.answerType;
  const cited = citedDocumentIds(answer);
  const retrieved = retrievedDocumentIds(answer);
  const citedLabels = new Set(
    answer.structuredAnswer.paragraphs.flatMap((paragraph) => paragraph.citations),
  );
  const citedSections = new Set(
    answer.retrieval.results
      .filter((result) => citedLabels.has(result.citationLabel))
      .map((result) => result.section ?? ""),
  );
  const sectionHit =
    question.expectedSections.length === 0
      ? null
      : question.expectedSections.some((section) => citedSections.has(section));
  const abstention = ABSTENTION_CATEGORIES.has(question.category);
  const liveRecall =
    abstention || question.expectedDocumentIds.length === 0
      ? null
      : question.expectedDocumentIds.filter((id) => retrieved.includes(id)).length /
        question.expectedDocumentIds.length;
  const goldRetrievedUncited = abstention
    ? []
    : question.expectedDocumentIds.filter((id) => retrieved.includes(id) && !cited.includes(id));
  const base = {
    questionId: question.questionId,
    category: question.category,
    answerType,
    citedDocumentIds: cited,
    retrievedDocumentIds: retrieved,
    sectionHit,
    liveRecall,
    goldRetrievedUncited,
    vectorDegradedCount: answer.vectorDegradedCount ?? 0,
    ...(answer.refusalReason ? { refusalReason: answer.refusalReason } : {}),
  };

  if (question.category === "permission" && options.liveLoopback) {
    return {
      ...base,
      status: "skipped",
      skipReason: LOOPBACK_SKIP,
      detail: LOOPBACK_SKIP,
    };
  }

  const leaked = retrieved.filter((id) => question.forbiddenDocumentIds.includes(id));
  if (leaked.length > 0) {
    return {
      ...base,
      status: "fail",
      detail: `Retrieved forbidden documents: ${leaked.join(", ")}.`,
    };
  }

  if (ABSTENTION_CATEGORIES.has(question.category)) {
    if (answerType !== "insufficient_evidence") {
      return {
        ...base,
        status: "fail",
        detail: `Expected insufficient_evidence for ${question.category}, got "${answerType}".`,
      };
    }
    if (cited.length > 0) {
      return {
        ...base,
        status: "fail",
        detail: `Abstention cited documents: ${cited.join(", ")}.`,
      };
    }
    return {
      ...base,
      status: "pass",
      detail: `Correct abstention for ${question.category}.`,
    };
  }

  if (answerType !== "grounded") {
    return {
      ...base,
      status: "fail",
      detail: `Expected a grounded answer, got "${answerType}".`,
    };
  }

  const expected = question.expectedDocumentIds;
  const citedExpected = cited.filter((id) => expected.includes(id));
  const requireAll = question.category === "multi_hop" || question.category === "multi_hop_expanded";
  if (requireAll) {
    const missing = expected.filter((id) => !cited.includes(id));
    if (missing.length > 0) {
      return {
        ...base,
        status: "fail",
        detail: `Multi-hop answer missing citations for ${missing.join(", ")}.`,
      };
    }
  } else if (citedExpected.length === 0) {
    return {
      ...base,
      status: "fail",
      detail: `Grounded answer did not cite expected documents (${expected.join(", ") || "none"}). Cited: ${cited.join(", ") || "none"}.`,
    };
  }

  const sectionNote =
    sectionHit === false
      ? ` Cited expected documents but not an expected section (${question.expectedSections.join(", ")}).`
      : "";
  return {
    ...base,
    status: "pass",
    detail: `${
      requireAll
        ? "Grounded answer cited every expected document."
        : `Grounded answer cited ${citedExpected.join(", ")}.`
    }${sectionNote}`,
  };
}
