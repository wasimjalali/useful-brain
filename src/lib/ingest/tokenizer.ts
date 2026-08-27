export const CHARS_PER_TOKEN = 6;

const PRETOKEN_RE =
  /'(?:[sdmt]|ll|ve|re)| ?[^\W\d_]+| ?\d+| ?(?:[^\s\w]|_)+|\s+/gu;

export function pretokenSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  PRETOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PRETOKEN_RE.exec(text)) !== null) {
    spans.push([match.index, match.index + match[0].length]);
    if (match[0].length === 0) {
      PRETOKEN_RE.lastIndex += 1;
    }
  }
  return spans;
}

export function pretokenCost(text: string): number {
  if (!text) {
    return 0;
  }
  if (isWhitespaceString(text)) {
    return (text.match(/\n/g) ?? []).length;
  }
  const stripped = text.trim();
  return Math.max(1, Math.round(stripped.length / CHARS_PER_TOKEN));
}

export function countTokens(text: string): number {
  return pretokenSpans(text).reduce(
    (total, [start, end]) => total + pretokenCost(text.slice(start, end)),
    0,
  );
}

export function isWhitespaceString(value: string): boolean {
  return value.length > 0 && /^\s+$/u.test(value);
}
