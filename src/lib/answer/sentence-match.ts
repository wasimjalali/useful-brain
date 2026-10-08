/**
 * Locates the evidence sentence an answer relied on. Copied from the chat
 * evidence inspector (findEvidenceSentenceMatch) so the Library reader can
 * highlight the same sentence server-side.
 */

export function normalizeForEvidenceMatch(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function findEvidenceSentenceMatch(text: string, focusText: string | null) {
  const normalizedFocus = normalizeForEvidenceMatch(focusText ?? "");
  if (!normalizedFocus) {
    return null;
  }

  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const value = sentences.find((sentence) =>
    normalizeForEvidenceMatch(sentence).includes(normalizedFocus),
  );
  if (!value) {
    return null;
  }

  const start = text.indexOf(value);
  return {
    before: text.slice(0, start),
    value,
    after: text.slice(start + value.length),
  };
}

export type SentenceRange = { start: number; end: number };

const MIN_OVERLAP = 0.6;
const MIN_CONTAINED_LENGTH = 12;

function contentTokens(value: string): string[] {
  return (value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? []).filter(
    (token) => token.length >= 4 || /\d/.test(token),
  );
}

function sentenceRanges(text: string): SentenceRange[] {
  const ranges: SentenceRange[] = [];
  for (const match of text.matchAll(/[^.!?]+[.!?]+|[^.!?]+$/g)) {
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const start = (match.index ?? 0) + lead;
    ranges.push({ start, end: start + trimmed.length });
  }
  return ranges;
}

/**
 * Sentences of `chunkText` the paragraph relied on, as ranges inside it.
 * Exact containment in either direction wins; otherwise the single best
 * sentence by content-token overlap, if it clears a floor. Returns nothing
 * rather than guessing.
 */
export function findRelianceSentences(chunkText: string, paragraphText: string): SentenceRange[] {
  const focus = normalizeForEvidenceMatch(paragraphText);
  if (!focus) {
    return [];
  }
  const ranges = sentenceRanges(chunkText);
  const contained = ranges.filter((range) => {
    const sentence = normalizeForEvidenceMatch(chunkText.slice(range.start, range.end));
    if (sentence.length === 0) {
      return false;
    }
    return (
      focus.includes(sentence) && sentence.length >= MIN_CONTAINED_LENGTH ||
      sentence.includes(focus)
    );
  });
  if (contained.length > 0) {
    return contained;
  }
  const focusTokens = new Set(contentTokens(focus));
  let best: SentenceRange | null = null;
  let bestScore = 0;
  for (const range of ranges) {
    const tokens = contentTokens(chunkText.slice(range.start, range.end));
    if (tokens.length < 3) {
      continue;
    }
    const score = tokens.filter((token) => focusTokens.has(token)).length / tokens.length;
    if (score > bestScore) {
      best = range;
      bestScore = score;
    }
  }
  return best && bestScore >= MIN_OVERLAP ? [best] : [];
}
