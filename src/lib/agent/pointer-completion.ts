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

const CITATION_LABEL_RE = /\[\d{1,2}\]/g;
/**
 * A figure is a quantity with a unit: a duration, a percentage or an amount
 * of money. Bare numbers (years, section and step numbers, counts) never
 * count, so a shared "2026" or "section 4" is not a restatement. Day and hour
 * qualifiers stay part of the figure: 5 business days is not 5 calendar days.
 */
const FIGURE_RE =
  /(\d+(?:\.\d+)?)\s+(?:(business|calendar|working)\s+)?(percent|dollars?|minutes?|hours?|days?|weeks?|months?|years?)\b/g;
/** One shared figure is coincidence; two in one passage is a restatement candidate. */
const MIN_SHARED_FIGURES = 2;

/**
 * Distinct figures in a text, in order: "30-day" and "30 days" are both
 * "30 day", "4 business hours" is "4 business hour", "$2,000" is
 * "2000 dollar" and "8%" is "8 percent". Citation labels are not figures.
 */
export function figureTokens(text: string): string[] {
  const prepared = text
    .toLowerCase()
    .replace(CITATION_LABEL_RE, " ")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\$\s?(\d+(?:\.\d+)?)/g, "$1 dollar")
    .replace(/(\d)\s?%/g, "$1 percent")
    .replace(/(\d)-(?=[a-z])/g, "$1 ");
  const figures: string[] = [];
  for (const match of prepared.matchAll(FIGURE_RE)) {
    const [, amount, qualifier, unit] = match;
    const figure = [amount, qualifier, unit.replace(/s$/, "")].filter(Boolean).join(" ");
    if (!figures.includes(figure)) {
      figures.push(figure);
    }
  }
  return figures;
}

export type PointerReason = "restates" | "contrast" | "named";

/**
 * Hint-cap order. Explicit contrasts and documents the question itself
 * names are protected; restating twins fill the remaining slots ahead of
 * documents named only by the draft or the cited evidence, which are the
 * noisiest signal (a cited chunk often lists every related policy).
 */
const TIER = { contrast: 0, namedInQuestion: 1, restates: 2, namedElsewhere: 3 } as const;

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
 * - `restates`: a chunk states every figure (at least two, with units) of
 *   one cited draft paragraph, so it may state the same rule; this is how a
 *   process document and the policy that owns its rule show up when neither
 *   names the other in the retrieved chunks. It is a candidate for the model
 *   to judge, never a finding;
 * - `contrast`: it explicitly contrasts itself with a cited document ("a
 *   different program");
 * - `named`: the question, draft or cited evidence names it by title.
 * Returned per document in hint-cap order (contrast, named in the
 * question, restates, named elsewhere) and then ledger order, so every
 * chunk of a hinted document is visible to the coverage pass.
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
  const questionText = normalizeSupportText(question);
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
  const best = new Map<string, { tier: number; reason: PointerReason }>();
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
    const contrasts =
      CONTRAST_RES.some((pattern) => pattern.test(item.text)) &&
      [...citedTitles.values()].some(
        (citedTokens) => citedTokens.length > 0 && titleReferenced(citedTokens, normalizeSupportText(item.text)),
      );
    const candidate = contrasts
      ? { tier: TIER.contrast, reason: "contrast" as const }
      : titleReferenced(titleTokens, questionText)
        ? { tier: TIER.namedInQuestion, reason: "named" as const }
        : restates
          ? { tier: TIER.restates, reason: "restates" as const }
          : titleReferenced(titleTokens, haystack)
            ? { tier: TIER.namedElsewhere, reason: "named" as const }
            : null;
    const previous = best.get(key);
    if (candidate && (!previous || candidate.tier < previous.tier)) {
      best.set(key, candidate);
    }
  }
  const ranked = [...best.entries()]
    .map(([key, { tier, reason }], order) => ({ key, tier, reason, order }))
    .sort((left, right) => left.tier - right.tier || left.order - right.order)
    .slice(0, MAX_HINTED_DOCUMENTS);
  return ranked.map(({ key, reason }) => ({
    reason,
    items: evidence.filter(
      (item) => documentKey(item) === key && !draftLabels.has(item.citationLabel) && Boolean(item.text),
    ),
  }));
}
