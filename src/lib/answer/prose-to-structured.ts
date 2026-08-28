import {
  BRAIN_INVALID_CITATION,
  BRAIN_KNOWLEDGE_UNAVAILABLE,
  BRAIN_MUST_RETRIEVE,
  BRAIN_NOT_ENOUGH_EVIDENCE,
  citedMarkerIndexes,
} from "../agent/host-grounding";
import {
  buildInsufficientEvidenceAnswer,
  type CitedRetrievalResult,
  type StructuredGroundedAnswer,
} from "./contract";

const HOST_STRINGS = new Set([
  BRAIN_NOT_ENOUGH_EVIDENCE,
  BRAIN_KNOWLEDGE_UNAVAILABLE,
  BRAIN_MUST_RETRIEVE,
  BRAIN_INVALID_CITATION,
]);

const MARKER_RE = /\[(\d{1,2})\]|〔(\d{1,2})〕/g;

export function structuredJsonFromGroundedProse(
  text: string,
  evidence: CitedRetrievalResult[],
): string {
  return JSON.stringify(structuredAnswerFromGroundedProse(text, evidence));
}

export function structuredAnswerFromGroundedProse(
  text: string,
  evidence: CitedRetrievalResult[],
): StructuredGroundedAnswer {
  const trimmed = text.trim();
  if (!trimmed || HOST_STRINGS.has(trimmed) || evidence.length === 0) {
    return buildInsufficientEvidenceAnswer();
  }
  const asJson = tryParseStructured(trimmed);
  if (asJson) {
    return asJson;
  }
  const valid = new Set(evidence.map((item) => item.citationLabel));
  const paragraphs = trimmed
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const citations = [...new Set(citedMarkerIndexes(paragraph))]
        .map((label) => `[${label}]`)
        .filter((label) => valid.has(label));
      const cleaned = paragraph.replace(MARKER_RE, "").replace(/\s+/g, " ").trim();
      return { text: cleaned, citations };
    })
    .filter((paragraph) => paragraph.text.length > 0 && paragraph.citations.length > 0);
  if (paragraphs.length === 0) {
    return buildInsufficientEvidenceAnswer();
  }
  return { answerType: "grounded", paragraphs };
}

function tryParseStructured(raw: string): StructuredGroundedAnswer | null {
  try {
    const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed: unknown = JSON.parse(stripped);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as { answerType?: unknown; paragraphs?: unknown };
    if (record.answerType !== "grounded" && record.answerType !== "insufficient_evidence") {
      return null;
    }
    if (!Array.isArray(record.paragraphs)) {
      return null;
    }
    return parsed as StructuredGroundedAnswer;
  } catch {
    return null;
  }
}
