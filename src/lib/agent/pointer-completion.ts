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
 * This module only detects those pointed-to documents: by title reference,
 * by explicit contrast language, and by restated figures (an uncited chunk
 * stating every figure of a cited draft paragraph). It selects no
 * sentences: wording stays with the model so the mechanism works on any
 * corpus, not one phrasing.
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

const FIGURE_UNITS = new Map([
  ["percent", "percent"],
  ["minute", "minute"],
  ["minutes", "minute"],
  ["hour", "hour"],
  ["hours", "hour"],
  ["day", "day"],
  ["days", "day"],
  ["week", "week"],
  ["weeks", "week"],
  ["month", "month"],
  ["months", "month"],
  ["year", "year"],
  ["years", "year"],
]);
const FIGURE_QUALIFIERS = new Set(["business", "calendar", "working"]);
const CITATION_LABEL_RE = /\[\d{1,2}\]/g;
/** One shared number is coincidence; two in one passage is a restatement. */
const MIN_SHARED_FIGURES = 2;

/**
 * Distinct figures in a text: a number with its unit when one follows
 * ("30-day" and "30 days" are both "30 day"; "4 business hours" is
 * "4 hour"), or the bare number ("$2,000" is "2000"). Citation labels are
 * not figures.
 */
export function figureTokens(text: string): string[] {
  const tokens = normalizeSupportText(
    text.replace(CITATION_LABEL_RE, " ").replace(/%/g, " percent "),
  ).split(" ");
  const figures: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!/^\d+$/.test(tokens[index])) {
      continue;
    }
    let number = tokens[index];
    while (/^\d{3}$/.test(tokens[index + 1] ?? "")) {
      index += 1;
      number += tokens[index];
    }
    let next = index + 1;
    if (FIGURE_QUALIFIERS.has(tokens[next] ?? "")) {
      next += 1;
    }
    const unit = FIGURE_UNITS.get(tokens[next] ?? "");
    const figure = unit ? `${number} ${unit}` : number;
    if (!figures.includes(figure)) {
      figures.push(figure);
    }
  }
  return figures;
}

export type PointerReason = "restates" | "contrast" | "named";

const REASON_PRIORITY: Record<PointerReason, number> = { restates: 0, contrast: 1, named: 2 };

export type PointerGroup = { reason: PointerReason; items: CitedRetrievalResult[] };

/** Per-document groups of {@link hintedPointerGroups}, for callers that need only the evidence. */
export function hintedUncitedDocuments(
  question: string,
  draft: string,
  evidence: CitedRetrievalResult[],
): CitedRetrievalResult[][] {
  return hintedPointerGroups(question, draft, evidence).map((group) => group.items);
}

/**
 * Uncited evidence documents the coverage pass should look at, with why:
 * - `restates`: a chunk states every figure (at least two) of one cited
 *   draft paragraph, so it restates the same rule; this is how a process
 *   document and the policy that owns its rule show up when neither names
 *   the other in the retrieved chunks;
 * - `contrast`: it explicitly contrasts itself with a cited document ("a
 *   different program");
 * - `named`: the question, draft or cited evidence names it by title.
 * Returned per document, strongest reason first and then in ledger order,
 * so every chunk of a hinted document is visible to the coverage pass and
 * the hint cap never evicts a restating twin in favor of a named neighbor.
 */
export function hintedPointerGroups(
  question: string,
  draft: string,
  evidence: CitedRetrievalResult[],
): PointerGroup[] {
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
  // Figures of each cited draft paragraph that carries at least two.
  const paragraphFigures = draft
    .split(/\n\s*\n/)
    .filter((paragraph) => /\[\d{1,2}\]/.test(paragraph))
    .map((paragraph) => figureTokens(paragraph))
    .filter((figures) => figures.length >= MIN_SHARED_FIGURES);
  const reasons = new Map<string, PointerReason>();
  for (const item of evidence) {
    const key = documentKey(item);
    if (draftLabels.has(item.citationLabel) || citedByDocument.has(key) || !item.text) {
      continue;
    }
    const itemFigures = new Set(figureTokens(item.text));
    const restates = paragraphFigures.some((figures) =>
      figures.every((figure) => itemFigures.has(figure)),
    );
    const titleTokens = documentTitleTokens(item.source);
    const named = titleReferenced(titleTokens, haystack);
    const contrasts =
      CONTRAST_RES.some((pattern) => pattern.test(item.text)) &&
      [...citedTitles.values()].some(
        (citedTokens) => citedTokens.length > 0 && titleReferenced(citedTokens, normalizeSupportText(item.text)),
      );
    const reason: PointerReason | null = restates
      ? "restates"
      : contrasts
        ? "contrast"
        : named
          ? "named"
          : null;
    const previous = reasons.get(key);
    if (reason && (!previous || REASON_PRIORITY[reason] < REASON_PRIORITY[previous])) {
      reasons.set(key, reason);
    }
  }
  const ranked = [...reasons.entries()]
    .map(([key, reason], order) => ({ key, reason, order }))
    .sort(
      (left, right) =>
        REASON_PRIORITY[left.reason] - REASON_PRIORITY[right.reason] || left.order - right.order,
    )
    .slice(0, MAX_HINTED_DOCUMENTS);
  return ranked.map(({ key, reason }) => ({
    reason,
    items: evidence.filter(
      (item) => documentKey(item) === key && !draftLabels.has(item.citationLabel) && Boolean(item.text),
    ),
  }));
}
