import { normalizeSupportText, type CitedRetrievalResult } from "../answer/contract";

/**
 * Pointer detection for the coverage pass.
 *
 * Company corpora routinely state a rule in one document while another
 * document owns it ("request earlier deletion through the Customer Data
 * Access Requests process", "the referral bonus ... is a different
 * program"). When a draft cites the neighbor but not the owner, the
 * coverage pass should take a second, model-judged look at the owner.
 *
 * This module only detects those pointed-to documents by title reference
 * and explicit contrast language. It selects no sentences: wording stays
 * with the model so the mechanism works on any corpus, not one phrasing.
 */

export const TITLE_STOP_WORDS = new Set([
  "and",
  "the",
  "of",
  "policy",
  "guide",
  "plan",
  "process",
]);

/** Explicit disambiguation language ("X is a different program"). */
const CONTRAST_RES = [
  /\bis a different (program|policy|process|plan)\b/iu,
  /\bseparate from\b/iu,
  /\bnot interchangeable\b/iu,
  /\bdoes not? replace\b/iu,
];

const MAX_HINTED_DOCUMENTS = 3;
const MIN_TITLE_MATCH = 2;

/** Distinctive title words for a source file ("referral-program.md"). */
export function documentTitleTokens(source: string): string[] {
  return normalizeSupportText(source.replace(/\.[a-z]+$/i, ""))
    .split(" ")
    .filter((token) => token.length > 1 && !TITLE_STOP_WORDS.has(token));
}

function titleMatchCount(titleTokens: string[], haystack: string): number {
  return titleTokens.filter((token) => haystack.includes(token)).length;
}

function titleReferenced(titleTokens: string[], haystack: string): boolean {
  if (titleTokens.length === 0) {
    return false;
  }
  const matched = titleMatchCount(titleTokens, haystack);
  return matched >= Math.min(MIN_TITLE_MATCH, titleTokens.length) && matched * 2 >= titleTokens.length;
}

function documentKey(item: CitedRetrievalResult): string {
  return item.documentId ?? item.source;
}

/**
 * Uncited evidence documents the question, draft or already-cited evidence
 * names by title, plus documents that explicitly contrast themselves with a
 * cited document ("a different program"). Returned as per-document groups
 * in ledger order so every chunk of a hinted document is visible to the
 * coverage pass.
 */
export function hintedUncitedDocuments(
  question: string,
  draft: string,
  evidence: CitedRetrievalResult[],
): CitedRetrievalResult[][] {
  const draftLabels = new Set(draft.match(/\[\d{1,2}\]/g) ?? []);
  const citedByDocument = new Set<string>();
  const citedTexts: string[] = [];
  for (const item of evidence) {
    if (draftLabels.has(item.citationLabel)) {
      citedByDocument.add(documentKey(item));
      if (item.text) {
        citedTexts.push(item.text);
      }
    }
  }
  const haystack = normalizeSupportText(`${question} ${draft} ${citedTexts.join(" ")}`);
  const citedTitles = new Map<string, string[]>();
  for (const item of evidence) {
    const key = documentKey(item);
    if (citedByDocument.has(key) && !citedTitles.has(key)) {
      citedTitles.set(key, documentTitleTokens(item.source));
    }
  }
  const groups = new Map<string, CitedRetrievalResult[]>();
  const hintedKeys = new Set<string>();
  for (const item of evidence) {
    const key = documentKey(item);
    if (draftLabels.has(item.citationLabel) || citedByDocument.has(key) || !item.text) {
      continue;
    }
    const titleTokens = documentTitleTokens(item.source);
    const named = titleReferenced(titleTokens, haystack);
    const contrasts =
      !named &&
      CONTRAST_RES.some((pattern) => pattern.test(item.text)) &&
      [...citedTitles.values()].some(
        (citedTokens) => citedTokens.length > 0 && titleReferenced(citedTokens, normalizeSupportText(item.text)),
      );
    if (named || contrasts) {
      hintedKeys.add(key);
    }
  }
  for (const item of evidence) {
    const key = documentKey(item);
    if (!hintedKeys.has(key) || draftLabels.has(item.citationLabel) || !item.text) {
      continue;
    }
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else if (groups.size < MAX_HINTED_DOCUMENTS) {
      groups.set(key, [item]);
    }
  }
  return [...groups.values()];
}
