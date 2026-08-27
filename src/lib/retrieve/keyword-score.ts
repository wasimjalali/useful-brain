import type { ChunkRecord, RetrievalHit } from "./types";

const K1 = 1.5;
const B = 0.75;
const TOKEN_RE = /\w+/gu;
const RAW_ALL_CAPS_RE = /\b[A-Z]{3,}\b/g;
const ALL_CAPS_STOP = new Set([
  "API", "CEO", "CFO", "CTO", "COO", "FAQ", "PDF", "URL", "HTTP", "HTTPS", "JSON",
  "HTML", "CSV", "XML", "AND", "THE", "FOR", "NOT", "YES", "ALL", "ANY", "HOW",
  "WHY", "WHO", "WHAT", "WHEN", "WHERE",
]);
const CLAUSE_ANCHOR_RE = /\bclause\s+\d+(?:\.\d+)*(?:\s*\([a-z0-9]+\))?/i;
const DOTTED_ID_RE = /\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*/i;
const HYPHEN_PAIR_RE = /\b([A-Za-z0-9]+)-([A-Za-z0-9]+)\b/g;

export function isIdentifierToken(token: string): boolean {
  if (!token) {
    return false;
  }
  return token.includes("_") || [...token].some((char) => char >= "0" && char <= "9");
}

function hyphenatedLiteral(raw: string): boolean {
  HYPHEN_PAIR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HYPHEN_PAIR_RE.exec(raw)) !== null) {
    const left = match[1];
    const right = match[2];
    const joined = left + right;
    if (![...joined].some((char) => char >= "0" && char <= "9")) {
      continue;
    }
    if (![...joined].some((char) => /[A-Za-z]/.test(char))) {
      continue;
    }
    if (/^\d+$/.test(left) && /^[a-z]+$/.test(right)) {
      continue;
    }
    if (/^\d+$/.test(right) && /^[a-z]+$/.test(left) && left.length > 5) {
      continue;
    }
    return true;
  }
  return false;
}

export function queryLooksLiteral(query: string): boolean {
  const raw = query.trim();
  if (!raw) {
    return false;
  }
  if (hyphenatedLiteral(raw)) {
    return true;
  }
  if (CLAUSE_ANCHOR_RE.test(raw)) {
    return true;
  }
  RAW_ALL_CAPS_RE.lastIndex = 0;
  let caps: RegExpExecArray | null;
  while ((caps = RAW_ALL_CAPS_RE.exec(raw)) !== null) {
    if (!ALL_CAPS_STOP.has(caps[0])) {
      return true;
    }
  }
  if (DOTTED_ID_RE.test(raw)) {
    return true;
  }
  for (const token of raw.toLowerCase().match(TOKEN_RE) ?? []) {
    if (!isIdentifierToken(token)) {
      continue;
    }
    if (token.includes("_") || /[a-z]/i.test(token)) {
      return true;
    }
  }
  return false;
}

export function stem(token: string): string {
  if (!/^[\x00-\x7F]+$/.test(token)) {
    return token;
  }
  if (isIdentifierToken(token)) {
    return token;
  }
  let next = token;
  if (next.length > 4 && next.endsWith("ies")) {
    next = `${next.slice(0, -3)}y`;
  } else if (next.length > 3 && next.endsWith("s") && !next.endsWith("ss")) {
    next = next.slice(0, -1);
  }
  if (next.length > 5 && next.endsWith("ing")) {
    next = next.slice(0, -3);
  } else if (next.length > 5 && next.endsWith("ed")) {
    next = next.slice(0, -2);
  }
  if (next.length > 4 && next.endsWith("e")) {
    next = next.slice(0, -1);
  }
  return next;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_RE) ?? []).map(stem);
}

function countTokens(tokens: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const token of tokens) {
    counts[token] = (counts[token] ?? 0) + 1;
  }
  return counts;
}

export function bm25Over(
  query: string,
  texts: Record<string, string>,
  background?: Record<string, string>,
): Record<string, number> {
  if (Object.keys(texts).length === 0) {
    return {};
  }
  const terms = new Set(tokenize(query));
  const countsById: Record<string, Record<string, number>> = {};
  for (const [key, text] of Object.entries(texts)) {
    countsById[key] = countTokens(tokenize(text));
  }
  const statsCounts: Record<string, Record<string, number>> = { ...countsById };
  for (const [key, text] of Object.entries(background ?? {})) {
    if (!(key in statsCounts)) {
      statsCounts[key] = countTokens(tokenize(text));
    }
  }
  const total = Object.keys(statsCounts).length;
  const averageLength =
    Object.values(statsCounts).reduce((sum, counts) => sum + Object.values(counts).reduce((a, b) => a + b, 0), 0) /
      total || 1;
  const documentFrequency: Record<string, number> = {};
  for (const counts of Object.values(statsCounts)) {
    for (const term of terms) {
      if (counts[term]) {
        documentFrequency[term] = (documentFrequency[term] ?? 0) + 1;
      }
    }
  }
  const scores: Record<string, number> = {};
  for (const [key, counts] of Object.entries(countsById)) {
    const length = Object.values(counts).reduce((a, b) => a + b, 0);
    let score = 0;
    if (length && terms.size) {
      for (const term of [...terms].sort()) {
        const frequency = counts[term] ?? 0;
        if (!frequency) {
          continue;
        }
        const appearances = documentFrequency[term] ?? 0;
        const idf = Math.log(1 + (total - appearances + 0.5) / (appearances + 0.5));
        score += idf * ((frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * length) / averageLength)));
      }
    }
    scores[key] = score;
  }
  return scores;
}

function passageForRescore(chunk: ChunkRecord): string {
  return chunk.sectionHeading ? `${chunk.sectionHeading}\n\n${chunk.content}` : chunk.content;
}

export function rescoreLocally(
  query: string,
  hits: RetrievalHit[],
  allowedChunks: ChunkRecord[],
): RetrievalHit[] {
  const background: Record<string, string> = {};
  for (const chunk of allowedChunks) {
    background[chunk.chunkId] = passageForRescore(chunk);
  }
  const scoredTexts: Record<string, string> = {};
  for (const hit of hits) {
    if (hit.chunkId in background) {
      scoredTexts[hit.chunkId] = background[hit.chunkId];
    }
  }
  const scores = bm25Over(query, scoredTexts, background);
  return hits
    .filter((hit) => hit.chunkId in scores)
    .map((hit) => ({ chunkId: hit.chunkId, score: scores[hit.chunkId] }));
}
