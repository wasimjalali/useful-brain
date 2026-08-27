import { CHARS_PER_TOKEN, isWhitespaceString, pretokenCost, pretokenSpans } from "./tokenizer";

export const SHIPPED_MAX_TOKENS = 300;
export const SHIPPED_OVERLAP_TOKENS = 30;
export const CHUNKING_VERSION = "300-30-v1";

const BOUNDARY_SEARCH = 0.25;

export type ChunkDocumentInput = {
  documentId: string;
  content: string;
};

export type ChunkRecord = {
  chunkId: string;
  documentId: string;
  sectionHeading: string;
  content: string;
  chunkIndex: number;
  charStart: number;
  charEnd: number;
};

export function chunkDocument(
  document: ChunkDocumentInput,
  options: { maxTokens?: number; overlapTokens?: number } = {},
): ChunkRecord[] {
  const maxTokens = options.maxTokens ?? SHIPPED_MAX_TOKENS;
  const overlapTokens = options.overlapTokens ?? SHIPPED_OVERLAP_TOKENS;
  if (maxTokens < 1) {
    throw new Error(`max_tokens must be >= 1, got ${maxTokens}`);
  }
  if (overlapTokens < 0) {
    throw new Error(`overlap_tokens must be >= 0, got ${overlapTokens}`);
  }
  if (overlapTokens >= maxTokens) {
    throw new Error(
      `overlap_tokens (${overlapTokens}) must be below max_tokens (${maxTokens})`,
    );
  }

  const chunks: ChunkRecord[] = [];
  let index = 0;
  for (const [heading, body, bodyStart] of splitSections(document.content)) {
    const lead = body.length - body.trimStart().length;
    const text = body.trim();
    if (!text) {
      continue;
    }
    const sectionBase = bodyStart + lead;
    for (const [part, localStart, localEnd] of splitTokenSpans(text, maxTokens, overlapTokens)) {
      chunks.push({
        chunkId: `${document.documentId}__${slug(heading)}__${String(index).padStart(3, "0")}`,
        documentId: document.documentId,
        sectionHeading: heading,
        content: part,
        chunkIndex: index,
        charStart: sectionBase + localStart,
        charEnd: sectionBase + localEnd,
      });
      index += 1;
    }
  }
  return chunks;
}

export function splitTokens(
  text: string,
  options: { maxTokens: number; overlapTokens: number },
): string[] {
  return splitTokenSpans(text, options.maxTokens, options.overlapTokens).map(([part]) => part);
}

export function splitTokenSpans(
  text: string,
  maxTokens: number,
  overlapTokens: number,
): Array<[string, number, number]> {
  const spans = boundedSpans(text, maxTokens);
  if (spans.length === 0) {
    return [];
  }
  const costs = spans.map(([start, end]) => pretokenCost(text.slice(start, end)));
  const parts: Array<[string, number, number]> = [];
  let start = 0;
  const n = spans.length;
  while (start < n) {
    let [end] = windowEnd(costs, start, maxTokens);
    end = preferBoundary(text, spans, start, end);
    const rawStart = spans[start][0];
    const rawEnd = spans[end - 1][1];
    const raw = text.slice(rawStart, rawEnd);
    const part = raw.trim();
    if (part) {
      const lead = raw.length - raw.trimStart().length;
      const partStart = rawStart + lead;
      parts.push([part, partStart, partStart + part.length]);
    }
    if (end >= n) {
      break;
    }
    const nextStart = overlapTokens ? overlapStart(costs, end, overlapTokens) : end;
    start = nextStart > start ? nextStart : end;
  }
  return parts;
}

function splitSections(content: string): Array<[string, string, number]> {
  const headingRe = /^(#{1,6})\s+(.+)$/gm;
  const matches = [...content.matchAll(headingRe)];
  if (matches.length === 0) {
    return [["Body", content, 0]];
  }
  const sections: Array<[string, string, number]> = [];
  const first = matches[0];
  const firstIndex = first.index ?? 0;
  if (firstIndex > 0) {
    const preamble = content.slice(0, firstIndex);
    if (preamble.trim()) {
      sections.push(["Body", preamble, 0]);
    }
  }
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const heading = match[2].trim();
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? content.length) : content.length;
    sections.push([heading, content.slice(start, end), start]);
  }
  return sections;
}

function boundedSpans(text: string, maxTokens: number): Array<[number, number]> {
  const ceiling = Math.max(1, Math.trunc(maxTokens * CHARS_PER_TOKEN));
  const bounded: Array<[number, number]> = [];
  for (const [start, end] of pretokenSpans(text)) {
    if (end - start <= ceiling) {
      bounded.push([start, end]);
      continue;
    }
    for (let cut = start; cut < end; cut += ceiling) {
      bounded.push([cut, Math.min(cut + ceiling, end)]);
    }
  }
  return bounded;
}

function windowEnd(costs: number[], start: number, maxTokens: number): [number, number] {
  let used = 0;
  let end = start;
  while (end < costs.length) {
    const cost = costs[end];
    if (used && used + cost > maxTokens) {
      break;
    }
    used += cost;
    end += 1;
  }
  return [Math.max(end, start + 1), used];
}

function preferBoundary(
  text: string,
  spans: Array<[number, number]>,
  start: number,
  end: number,
): number {
  if (end >= spans.length || end - start < 4) {
    return end;
  }
  const window = end - start;
  const earliest = start + Math.max(1, Math.trunc(window * (1 - BOUNDARY_SEARCH)));
  for (const boundary of [endsParagraph, endsSentence]) {
    for (let candidate = end - 1; candidate >= earliest; candidate -= 1) {
      if (boundary(text, spans, candidate)) {
        return candidate + 1;
      }
    }
  }
  return end;
}

function endsParagraph(text: string, spans: Array<[number, number]>, i: number): boolean {
  const following = i + 1 < spans.length ? text.slice(spans[i][1], spans[i + 1][1]) : "";
  return following.includes("\n\n");
}

function endsSentence(text: string, spans: Array<[number, number]>, i: number): boolean {
  const token = text.slice(spans[i][0], spans[i][1]).trim();
  if (!/[.!?:;]$/.test(token)) {
    return false;
  }
  const following = text.slice(spans[i][1], spans[i][1] + 1);
  return following === "" || isWhitespaceString(following);
}

function overlapStart(costs: number[], end: number, overlapTokens: number): number {
  let used = 0;
  let i = end;
  while (i > 0 && used < overlapTokens) {
    i -= 1;
    used += costs[i];
  }
  return i;
}

function slug(value: string): string {
  const slugValue = value
    .trim()
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slugValue || "section";
}
