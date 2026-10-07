import type {
  AnswerParagraphView,
  CitedPassageView,
  HighlightRange,
  ReaderDocumentView,
  ReaderSectionView,
  ReaderSegmentView,
  RetrievedPassageView,
  SourceRefView,
} from "@/lib/contracts/chat-view";
import type { ChatEvidenceRow } from "@/lib/contracts/chat";
import type { DocumentReaders, DocumentResponse } from "@/lib/contracts/library";
import type { CitedRetrievalResult, GroundedAnswerResponse } from "@/lib/rag/grounded-answer";

/** "[3]" becomes 3. Anything else is not a citation label. */
export function labelNumber(label: string): number | null {
  const match = /^\[(\d+)\]$/.exec(label);
  return match ? Number(match[1]) : null;
}

type Results = GroundedAnswerResponse["retrieval"]["results"];

function isActionNote(paragraph: object): boolean {
  return (paragraph as { kind?: unknown }).kind === "action_note";
}

function resultByNumber(results: Results): Map<number, CitedRetrievalResult> {
  const byNumber = new Map<number, CitedRetrievalResult>();
  for (const result of results) {
    const n = labelNumber(result.citationLabel);
    if (n !== null && !byNumber.has(n)) {
      byNumber.set(n, result);
    }
  }
  return byNumber;
}

/** Catalog title when the stored snapshot has one, else the source name. */
export function documentName(result: CitedRetrievalResult): string {
  return (result as ChatEvidenceRow).documentTitle ?? result.source;
}

/** Validated paragraphs. A citation that is not in the evidence snapshot never reaches a chip. */
export function paragraphViews(answer: GroundedAnswerResponse): AnswerParagraphView[] {
  const known = resultByNumber(answer.retrieval.results);
  return answer.structuredAnswer.paragraphs.map((paragraph) => {
    if (isActionNote(paragraph)) {
      return { text: paragraph.text, citations: [] };
    }
    const numbers = paragraph.citations
      .map(labelNumber)
      .filter((n): n is number => n !== null && known.has(n));
    return { text: paragraph.text, citations: [...new Set(numbers)] };
  });
}

/** Citation numbers the answer relied on, ascending. */
export function citedNumbers(answer: GroundedAnswerResponse): number[] {
  const all = paragraphViews(answer).flatMap((paragraph) => paragraph.citations);
  return [...new Set(all)].sort((a, b) => a - b);
}

export function sourceRefs(answer: GroundedAnswerResponse): SourceRefView[] {
  const byNumber = resultByNumber(answer.retrieval.results);
  return citedNumbers(answer).flatMap((n) => {
    const result = byNumber.get(n);
    return result ? [{ n, document: documentName(result), section: result.section }] : [];
  });
}

const STOP_LENGTH = 4;

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length >= STOP_LENGTH);
}

/**
 * Sentences of a passage the answer relied on, found by word overlap with the
 * paragraphs that cite it. No overlap means no highlight, never a guess.
 */
export function highlightRanges(chunkText: string, citingParagraphs: string[]): HighlightRange[] {
  if (!chunkText || citingParagraphs.length === 0) {
    return [];
  }
  const answerWords = new Set(contentWords(citingParagraphs.join(" ").replace(/\[\d+\]/g, " ")));
  const scored: Array<{ range: HighlightRange; score: number; words: number }> = [];
  for (const match of chunkText.matchAll(/[^.!?\n]+[.!?]*/g)) {
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    const sentence = raw.trim();
    const words = contentWords(sentence);
    if (!sentence || words.length === 0) {
      continue;
    }
    const hits = words.filter((word) => answerWords.has(word)).length;
    const start = (match.index ?? 0) + lead;
    scored.push({ range: { start, end: start + sentence.length }, score: hits / words.length, words: hits });
  }
  const strong = scored.filter((s) => s.score >= 0.6 && s.words >= 2);
  if (strong.length > 0) {
    return strong.map((s) => s.range);
  }
  const best = [...scored].sort((a, b) => b.score - a.score)[0];
  return best && best.score >= 0.4 && best.words >= 2 ? [best.range] : [];
}

export function citedPassages(
  answer: GroundedAnswerResponse,
  { isAdmin }: { isAdmin: boolean },
): CitedPassageView[] {
  const byNumber = resultByNumber(answer.retrieval.results);
  const paragraphs = paragraphViews(answer);
  return citedNumbers(answer).flatMap((n) => {
    const result = byNumber.get(n);
    if (!result) {
      return [];
    }
    const citing = paragraphs.filter((p) => p.citations.includes(n)).map((p) => p.text);
    return [
      {
        n,
        chunkId: result.chunkId,
        document: documentName(result),
        section: result.section,
        text: result.text,
        highlights: highlightRanges(result.text, citing),
        ...(isAdmin
          ? {
              generation: answer.corpusGenerationId ?? undefined,
              keywordScore: result.keywordScore ?? null,
              vectorScore: result.vectorScore ?? null,
              rerankScore: result.rerankScore ?? null,
            }
          : {}),
      },
    ];
  });
}

export function retrievedPassages(
  answer: GroundedAnswerResponse,
  { isAdmin }: { isAdmin: boolean },
): RetrievedPassageView[] {
  const cited = new Set(citedNumbers(answer));
  return answer.retrieval.results.map((result) => {
    const n = labelNumber(result.citationLabel);
    return {
      rank: result.rank,
      chunkId: result.chunkId,
      document: documentName(result),
      section: result.section,
      cited: n !== null && cited.has(n),
      ...(isAdmin ? { rerankScore: result.rerankScore ?? null } : {}),
    };
  });
}

/** Document id behind citation `n`, from the frozen snapshot. */
export function documentIdForCitation(answer: GroundedAnswerResponse, n: number): string | null {
  return resultByNumber(answer.retrieval.results).get(n)?.documentId ?? null;
}

function listPhrase(names: string[], joiner: string): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${joiner} ${names[names.length - 1]}`;
}

/** "only {phrase} can read it". */
export function readersPhrase(readers: DocumentReaders): string {
  if (readers.kind === "everyone") return "everyone";
  if (readers.kind === "private") return "its owner";
  return listPhrase(readers.names, "and");
}

function readersLabel(readers: DocumentReaders): { label: string; everyone: boolean } {
  if (readers.kind === "everyone") return { label: "Everyone", everyone: true };
  if (readers.kind === "private") return { label: "Private", everyone: false };
  return { label: readers.names.join(", "), everyone: false };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NOT_SET = "Not set";

function formatEffective(date: string | null): string {
  const match = date ? /^(\d{4})-(\d{2})-(\d{2})/.exec(date) : null;
  if (!match) return date ?? NOT_SET;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}`;
}

type SpanInput = NonNullable<DocumentResponse["spans"]>[number];

function segmentsFor(text: string, offset: number, spans: SpanInput[]): ReaderSegmentView[] {
  const end = offset + text.length;
  const inside = spans
    .map((span) => ({
      start: Math.max(span.start, offset),
      end: Math.min(span.end, end),
      n: labelNumber(span.citation),
    }))
    .filter((span) => span.end > span.start && span.n !== null)
    .sort((a, b) => a.start - b.start);
  const segments: ReaderSegmentView[] = [];
  let cursor = offset;
  for (const span of inside) {
    const start = Math.max(span.start, cursor);
    if (span.end <= start) continue;
    if (start > cursor) {
      segments.push({ text: text.slice(cursor - offset, start - offset) });
    }
    segments.push({ text: text.slice(start - offset, span.end - offset), citation: span.n as number });
    cursor = span.end;
  }
  if (cursor < end) {
    segments.push({ text: text.slice(cursor - offset) });
  }
  return segments;
}

function sectionView(heading: string, text: string, spans: SpanInput[]): ReaderSectionView {
  const paragraphs: ReaderSegmentView[][] = [];
  let cursor = 0;
  for (const part of text.split(/\n{2,}/)) {
    const start = text.indexOf(part, cursor);
    cursor = start + part.length;
    if (part.trim()) {
      paragraphs.push(segmentsFor(part, start, spans));
    }
  }
  return { heading, paragraphs };
}

/** Reader view of a stored document, with the relied-on spans marked in place. */
export function readerFromDocument(doc: DocumentResponse): { view: ReaderDocumentView; activeN: number | null } {
  const spans = doc.spans ?? [];
  const active = spans.find((span) => span.active);
  return {
    view: {
      title: doc.title,
      version: doc.version ?? NOT_SET,
      effective: formatEffective(doc.effectiveDate),
      readableBy: readersLabel(doc.readers),
      owner: doc.ownerDepartment ?? NOT_SET,
      sections: doc.sections.map((section, index) =>
        sectionView(
          section.heading,
          section.text,
          spans.filter((span) => span.section === index),
        ),
      ),
    },
    activeN: active ? labelNumber(active.citation) : null,
  };
}
