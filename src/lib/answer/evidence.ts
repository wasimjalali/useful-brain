import type { SearchHit } from "../retrieve/types";
import {
  addCitationLabels,
  type CitedRetrievalResult,
  type RetrievalResultForAnswer,
} from "./contract";

export function tokenEstimate(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function hitsToEvidence(hits: SearchHit[]): CitedRetrievalResult[] {
  const results: RetrievalResultForAnswer[] = hits.map((hit, index) => ({
    rank: index + 1,
    score: hit.score,
    chunkId: hit.chunkId,
    source: hit.citation.sourceName,
    section: hit.citation.sectionHeading,
    text: hit.content,
    tokenEstimate: tokenEstimate(hit.content),
    documentId: hit.citation.documentId,
  }));
  return addCitationLabels(results);
}
