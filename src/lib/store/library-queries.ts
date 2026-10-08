import { readableDocumentPredicate, type Principal } from "../acl/access";
import { WorkerNotFoundError } from "../cf/worker-errors";
import { findRelianceSentences } from "../answer/sentence-match";
import type {
  ChatSearchHit,
  DocumentReaders,
  DocumentResponse,
  DocumentSearchHit,
  DocumentSection,
  DocumentSpan,
  LibraryDocument,
  MatchRange,
} from "../contracts/library";
import type { SqlExecutor } from "./corpus-d1";
import type { OperationsDatabase } from "./conversations";

export const SEARCH_RESULT_LIMIT = 5;
const SNIPPET_LENGTH = 110;

type CatalogRow = {
  document_id: string;
  title: string;
  department: string | null;
  version: string | null;
  effective_date: string | null;
  headings_json: string;
  access_scope: string;
  allowed_roles: string;
  allowed_departments: string;
};

const CATALOG_COLUMNS = `c.document_id, c.title, c.department, c.version, c.effective_date,
  c.headings_json, c.access_scope, c.allowed_roles, c.allowed_departments`;

export { readableDocumentPredicate };

function parseList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function readersOf(row: Pick<CatalogRow, "access_scope" | "allowed_roles" | "allowed_departments">): DocumentReaders {
  switch (row.access_scope) {
    case "department":
      return { kind: "departments", names: parseList(row.allowed_departments) };
    case "role":
      return { kind: "roles", names: parseList(row.allowed_roles) };
    case "private":
      return { kind: "private", names: [] };
    default:
      return { kind: "everyone", names: [] };
  }
}

export async function listLibrary(
  db: SqlExecutor,
  generationId: string,
  principal: Principal,
): Promise<LibraryDocument[]> {
  const readable = readableDocumentPredicate(generationId, principal);
  const rows = await db
    .prepare(
      `SELECT ${CATALOG_COLUMNS} FROM document_catalog c WHERE ${readable.sql}
       ORDER BY c.title COLLATE NOCASE, c.document_id`,
    )
    .bind(...readable.params)
    .all<CatalogRow>();
  return rows.results.map((row) => ({
    id: row.document_id,
    title: row.title,
    department: row.department,
    readers: readersOf(row),
    headings: parseList(row.headings_json),
  }));
}

/** Throws the uniform NOT_FOUND unless the principal can read the document in this generation. */
export async function resolveScopedDocument(
  db: SqlExecutor,
  generationId: string,
  principal: Principal,
  documentId: string,
): Promise<string> {
  const readable = readableDocumentPredicate(generationId, principal);
  const row = await db
    .prepare(`SELECT c.document_id FROM document_catalog c WHERE c.document_id = ? AND ${readable.sql}`)
    .bind(documentId, ...readable.params)
    .first<{ document_id: string }>();
  if (!row) {
    throw new WorkerNotFoundError();
  }
  return row.document_id;
}

export type ParsedSection = DocumentSection & { bodyStart: number; bodyEnd: number };

/** Splits a markdown body on heading lines. Sections without text are dropped. */
export function splitSections(body: string, fallbackHeading: string): ParsedSection[] {
  const headings: Array<{ heading: string; lineStart: number; textFrom: number }> = [];
  for (const match of body.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*$/gm)) {
    const lineStart = match.index ?? 0;
    headings.push({ heading: match[1], lineStart, textFrom: lineStart + match[0].length });
  }
  const parts: Array<{ heading: string; from: number; to: number }> = [];
  const firstLine = headings.length > 0 ? headings[0].lineStart : body.length;
  parts.push({ heading: fallbackHeading, from: 0, to: firstLine });
  headings.forEach((entry, index) => {
    parts.push({
      heading: entry.heading,
      from: entry.textFrom,
      to: index + 1 < headings.length ? headings[index + 1].lineStart : body.length,
    });
  });
  const sections: ParsedSection[] = [];
  for (const part of parts) {
    const raw = body.slice(part.from, part.to);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text.length === 0) {
      continue;
    }
    sections.push({
      heading: part.heading,
      text,
      bodyStart: part.from + lead,
      bodyEnd: part.from + lead + text.length,
    });
  }
  return sections;
}

type LoadedDocument = {
  row: CatalogRow;
  body: string;
  reconstructed: boolean;
  sections: ParsedSection[];
};

export async function loadReadableDocument(
  db: SqlExecutor,
  generationId: string,
  principal: Principal,
  documentId: string,
): Promise<LoadedDocument> {
  const readable = readableDocumentPredicate(generationId, principal);
  const row = await db
    .prepare(
      `SELECT ${CATALOG_COLUMNS}, b.body AS body, b.reconstructed AS reconstructed
       FROM document_catalog c
       JOIN document_bodies b ON b.document_id = c.document_id AND b.generation_id = c.generation_id
       WHERE c.document_id = ? AND ${readable.sql}`,
    )
    .bind(documentId, ...readable.params)
    .first<CatalogRow & { body: string; reconstructed: number }>();
  if (!row) {
    throw new WorkerNotFoundError();
  }
  return {
    row,
    body: row.body,
    reconstructed: row.reconstructed === 1,
    sections: splitSections(row.body, row.title),
  };
}

export function documentResponse(loaded: LoadedDocument): DocumentResponse {
  const { row } = loaded;
  return {
    id: row.document_id,
    title: row.title,
    version: row.version,
    effectiveDate: row.effective_date,
    ownerDepartment: row.department,
    readers: readersOf(row),
    sections: loaded.sections.map(({ heading, text }) => ({ heading, text })),
  };
}

type MessageRow = { structured_paragraphs_json: string | null };
type EvidenceRow = { citation_label: string; chunk_id: string };
type ChunkRow = { content: string; start_offset: number; end_offset: number };

/**
 * Highlight spans for the sentences a caller's own answer relied on inside this
 * document. Throws NOT_FOUND unless the caller owns the message. Returns null
 * when the message did not cite the document or the body is reconstructed.
 */
export async function loadReliedOnSpans(
  operations: OperationsDatabase,
  corpus: SqlExecutor,
  generationId: string,
  principal: Principal,
  loaded: LoadedDocument,
  messageId: string,
  activeCitation: string | null,
): Promise<DocumentSpan[] | null> {
  const message = await operations
    .prepare(
      `SELECT m.structured_paragraphs_json FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       WHERE m.id = ? AND m.role = 'assistant' AND cv.owner_principal_id = ?`,
    )
    .bind(messageId, principal.userId)
    .first<MessageRow>();
  if (!message) {
    throw new WorkerNotFoundError();
  }
  if (loaded.reconstructed) {
    return null;
  }
  const evidence = await operations
    .prepare(
      `SELECT citation_label, chunk_id FROM evidence_snapshots WHERE message_id = ? AND document_id = ?`,
    )
    .bind(messageId, loaded.row.document_id)
    .all<EvidenceRow>();
  if (evidence.results.length === 0 || !message.structured_paragraphs_json) {
    return null;
  }
  let paragraphs: unknown;
  try {
    paragraphs = JSON.parse(message.structured_paragraphs_json);
  } catch {
    return null;
  }
  if (!Array.isArray(paragraphs)) {
    return null;
  }
  const spans: DocumentSpan[] = [];
  const seen = new Set<string>();
  for (const item of evidence.results) {
    const chunk = await corpus
      .prepare(
        `SELECT content, start_offset, end_offset FROM chunks
         WHERE chunk_id = ? AND document_id = ? AND generation_id = ?`,
      )
      .bind(item.chunk_id, loaded.row.document_id, generationId)
      .first<ChunkRow>();
    if (!chunk || loaded.body.slice(chunk.start_offset, chunk.end_offset) !== chunk.content) {
      continue;
    }
    for (const paragraph of paragraphs as Array<{ text?: unknown; citations?: unknown }>) {
      if (
        typeof paragraph.text !== "string" ||
        !Array.isArray(paragraph.citations) ||
        !paragraph.citations.includes(item.citation_label)
      ) {
        continue;
      }
      for (const range of findRelianceSentences(chunk.content, paragraph.text)) {
        const bodyStart = chunk.start_offset + range.start;
        const bodyEnd = chunk.start_offset + range.end;
        const index = loaded.sections.findIndex(
          (section) => bodyStart >= section.bodyStart && bodyEnd <= section.bodyEnd,
        );
        if (index < 0) {
          continue;
        }
        const start = bodyStart - loaded.sections[index].bodyStart;
        const end = bodyEnd - loaded.sections[index].bodyStart;
        const key = `${index}:${start}:${end}:${item.citation_label}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        spans.push({ section: index, start, end, citation: item.citation_label, active: false });
      }
    }
  }
  if (spans.length === 0) {
    return null;
  }
  spans.sort((a, b) => a.section - b.section || a.start - b.start);
  const active = activeCitation ? spans.find((span) => span.citation === activeCitation) : spans[0];
  (active ?? spans[0]).active = true;
  return spans;
}

/* ----------------------------- search ----------------------------- */

export function searchTokens(query: string): string[] {
  return [...new Set((query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []))];
}

/** Quoted prefix terms joined by AND: syntax in the user's text can never reach FTS5. */
export function ftsPrefixQuery(tokens: string[]): string | null {
  if (tokens.length === 0) {
    return null;
  }
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" ");
}

export function matchRanges(text: string, tokens: string[]): MatchRange[] {
  const lower = text.toLowerCase();
  const ranges: MatchRange[] = [];
  for (const token of tokens) {
    for (let at = lower.indexOf(token); at >= 0; at = lower.indexOf(token, at + token.length)) {
      ranges.push([at, at + token.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: MatchRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  return merged;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function excerpt(text: string, tokens: string[]): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const token of tokens) {
    const found = lower.indexOf(token);
    if (found >= 0 && (at < 0 || found < at)) {
      at = found;
    }
  }
  const from = Math.max(0, at - 30);
  const piece = flat.slice(from, from + SNIPPET_LENGTH);
  return `${from > 0 ? "…" : ""}${piece}${from + SNIPPET_LENGTH < flat.length ? "…" : ""}`;
}

function documentSnippet(body: string, title: string, tokens: string[]): string | null {
  const sections = splitSections(body, title);
  const section =
    sections.find((s) => tokens.some((t) => s.heading.toLowerCase().includes(t))) ??
    sections.find((s) => tokens.some((t) => s.text.toLowerCase().includes(t))) ??
    sections[0];
  return section ? `${section.heading} · ${excerpt(section.text, tokens)}` : null;
}

/** Upper bound on readable matches ranked locally; ordered by title, so independent of hidden rows. */
const SEARCH_CANDIDATE_CAP = 500;

function coverage(text: string, tokens: string[]): number {
  const lower = text.toLowerCase();
  return tokens.filter((token) => lower.includes(token)).length;
}

type SearchCandidate = { document_id: string; title: string; department: string | null; headings_json: string };

/**
 * FTS decides membership only. Its bm25 score uses corpus-wide statistics that
 * include documents the caller cannot read, so ranking is computed here from
 * the readable rows alone: title coverage, heading coverage, then title and id.
 */
export async function searchDocuments(
  db: SqlExecutor,
  generationId: string,
  principal: Principal,
  tokens: string[],
): Promise<DocumentSearchHit[]> {
  const match = ftsPrefixQuery(tokens);
  if (!match) {
    return [];
  }
  const readable = readableDocumentPredicate(generationId, principal);
  const found = await db
    .prepare(
      `SELECT c.document_id, c.title, c.department, c.headings_json
       FROM document_catalog_fts f
       JOIN document_catalog c ON c.id = f.rowid
       WHERE document_catalog_fts MATCH ? AND ${readable.sql}
       ORDER BY c.title COLLATE NOCASE, c.document_id
       LIMIT ?`,
    )
    .bind(match, ...readable.params, SEARCH_CANDIDATE_CAP)
    .all<SearchCandidate>();
  const ranked = found.results
    .map((row) => ({
      row,
      titleScore: coverage(row.title, tokens),
      headingScore: coverage(parseList(row.headings_json).join(" "), tokens),
    }))
    .sort(
      (a, b) =>
        b.titleScore - a.titleScore ||
        b.headingScore - a.headingScore ||
        a.row.title.toLowerCase().localeCompare(b.row.title.toLowerCase()) ||
        (a.row.document_id < b.row.document_id ? -1 : a.row.document_id > b.row.document_id ? 1 : 0),
    )
    .slice(0, SEARCH_RESULT_LIMIT)
    .map((entry) => entry.row);
  if (ranked.length === 0) {
    return [];
  }
  // Bodies only for the hits that survived ranking; these ids already passed the predicate.
  const bodies = await db
    .prepare(
      `SELECT document_id, body FROM document_bodies
       WHERE generation_id = ? AND document_id IN (${ranked.map(() => "?").join(",")})`,
    )
    .bind(generationId, ...ranked.map((row) => row.document_id))
    .all<{ document_id: string; body: string }>();
  const bodyOf = new Map(bodies.results.map((row) => [row.document_id, row.body]));
  return ranked.map((row) => {
    const body = bodyOf.get(row.document_id);
    return {
      id: row.document_id,
      title: row.title,
      department: row.department,
      titleMatches: matchRanges(row.title, tokens),
      snippet: body ? documentSnippet(body, row.title, tokens) : null,
    };
  });
}

/** The caller's own conversations only: owner is part of the WHERE, never a post-filter. */
export async function searchChats(
  operations: OperationsDatabase,
  principalId: string,
  query: string,
): Promise<ChatSearchHit[]> {
  const like = `%${escapeLike(query.toLowerCase())}%`;
  const rows = await operations
    .prepare(
      `SELECT cv.id AS id, cv.title AS title,
         (SELECT m.content FROM messages m
          WHERE m.conversation_id = cv.id AND m.content LIKE ? ESCAPE '\\'
          ORDER BY m.created_at, m.id LIMIT 1) AS message
       FROM conversations cv
       WHERE cv.owner_principal_id = ?
         AND (cv.title LIKE ? ESCAPE '\\'
              OR EXISTS (SELECT 1 FROM messages m2 WHERE m2.conversation_id = cv.id AND m2.content LIKE ? ESCAPE '\\'))
       ORDER BY cv.updated_at DESC, cv.id DESC
       LIMIT ?`,
    )
    .bind(like, principalId, like, like, SEARCH_RESULT_LIMIT)
    .all<{ id: string; title: string; message: string | null }>();
  const lowered = query.toLowerCase();
  return rows.results.map((row) => ({
    id: row.id,
    title: row.title,
    titleMatches: matchRanges(row.title, [lowered]),
    snippet: row.message ? excerpt(row.message, [lowered]) : null,
  }));
}
