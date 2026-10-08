import { countReadableDocuments } from "../acl/access";
import type { DirectoryRecord } from "../auth/principal";
import { parseBoundedId } from "../cf/bounded-id";
import { WorkerNotFoundError, WorkerValidationError } from "../cf/worker-errors";
import type { AdminDiagnosticMatch, AssumedPersonEcho } from "../contracts/turn";
import { sha256Hex } from "../ingest/digests";
import type { CorpusSql } from "../retrieve/cloudflare-pipeline";
import { activeGenerationId, type SqlExecutor } from "../store/corpus-d1";
import type { OperationsDatabase } from "../store/conversations";
import { readersOf } from "../store/library-queries";
import type { GroundedAnswerResponse } from "../rag/grounded-answer";

const MAX_DIAGNOSTIC_MATCHES = 3;
const MIN_TOKEN_LENGTH = 3;
const STOPWORDS = new Set([
  "the", "and", "for", "are", "what", "how", "can", "does", "who", "why", "when", "where",
  "with", "from", "this", "that", "have", "has", "our", "your", "about", "any", "into", "was",
  "were", "will", "would", "should", "could", "there", "their", "them", "they", "you", "not",
]);

export type AssumedPerson = {
  record: DirectoryRecord;
  displayName: string;
  department: string | null;
};

/**
 * Resolves a principals.id server-side. Roles and departments always come from
 * the operations directory, never from the request. Only employee principals can
 * be viewed as: a service token is not a person.
 */
export async function loadAssumedPerson(
  db: OperationsDatabase,
  assumePrincipalId: string,
): Promise<AssumedPerson> {
  const id = parseBoundedId(assumePrincipalId, "principal id");
  const principal = await db
    .prepare(
      `SELECT p.id AS id, p.subject AS subject, p.kind AS kind, u.name AS name
       FROM principals p LEFT JOIN auth_users u ON u.id = p.id
       WHERE p.id = ?`,
    )
    .bind(id)
    .first<{ id: string; subject: string; kind: string; name: string | null }>();
  if (!principal || principal.kind !== "user") {
    throw new WorkerNotFoundError();
  }
  const roles = await db
    .prepare(`SELECT role FROM roles WHERE principal_id = ? ORDER BY role`)
    .bind(id)
    .all<{ role: string }>();
  const departments = await db
    .prepare(`SELECT department FROM departments WHERE principal_id = ? ORDER BY department`)
    .bind(id)
    .all<{ department: string }>();
  const record: DirectoryRecord = {
    id: principal.id,
    subject: principal.subject,
    kind: "user",
    roles: roles.results.map((row) => row.role),
    departments: departments.results.map((row) => row.department),
  };
  return {
    record,
    displayName: principal.name?.trim() || principal.subject.split("@")[0],
    department: record.departments[0] ?? null,
  };
}

export async function echoAssumedPerson(
  person: AssumedPerson,
  corpus: CorpusSql | undefined,
): Promise<AssumedPersonEcho> {
  let readableDocuments = 0;
  if (corpus) {
    const generationId = await activeGenerationId(corpus as unknown as SqlExecutor);
    if (generationId) {
      readableDocuments = await countReadableDocuments(
        corpus as unknown as SqlExecutor,
        generationId,
        {
          userId: person.record.id,
          roles: person.record.roles,
          departments: person.record.departments,
        },
      );
    }
  }
  return {
    id: person.record.id,
    displayName: person.displayName,
    department: person.department,
    readableDocuments,
  };
}

/**
 * Binds a request id to its question and, when scoped, its document scope.
 * Stored in question_sha256; an unscoped request keeps the plain question hash.
 */
async function auditRequestDigest(question: string, scopeDocumentId?: string): Promise<string> {
  return sha256Hex(scopeDocumentId === undefined ? question : `${question}\u0000scope:${scopeDocumentId}`);
}

/**
 * Claims the request id and writes the audit row before the run. A view-as
 * turn is ephemeral and cannot be replayed, so a request id executes at most
 * once: any repeat (same or different admin, person, question or scope,
 * concurrent or later) is refused before anything runs, and the first
 * execution's audit row is never touched by it.
 */
export async function beginViewAsAudit(
  db: OperationsDatabase,
  input: {
    requestId: string;
    adminPrincipalId: string;
    assumedPrincipalId: string;
    question: string;
    scopeDocumentId?: string;
    now: number;
  },
): Promise<void> {
  const requestId = parseBoundedId(input.requestId, "request id");
  const questionSha = await auditRequestDigest(input.question, input.scopeDocumentId);
  const claimed = await db
    .prepare(
      `INSERT INTO view_as_audits
         (id, request_id, admin_principal_id, assumed_principal_id, question_sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(request_id) DO NOTHING`,
    )
    .bind(
      await viewAsAuditId(requestId),
      requestId,
      input.adminPrincipalId,
      input.assumedPrincipalId,
      questionSha,
      input.now,
    )
    .run();
  if ((claimed.meta?.changes ?? 0) !== 1) {
    throw new WorkerValidationError();
  }
}

/** `answerType` is "error" when the turn failed. Throws when the audit row cannot be completed. */
export async function finishViewAsAudit(
  db: OperationsDatabase,
  input: {
    requestId: string;
    answerType: string;
    citedDocumentIds: string[];
    diagnosticShown: boolean;
  },
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE view_as_audits
       SET answer_type = ?, cited_document_ids_json = ?, diagnostic_shown = ?
       WHERE request_id = ?`,
    )
    .bind(
      input.answerType,
      JSON.stringify([...new Set(input.citedDocumentIds)].slice(0, 20)),
      input.diagnosticShown ? 1 : 0,
      parseBoundedId(input.requestId, "request id"),
    )
    .run();
  if ((result.meta?.changes ?? 0) !== 1) {
    throw new Error("view_as_audit_missing");
  }
}

function titleQuery(question: string): string | null {
  const tokens = [
    ...new Set(
      (question.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter(
        (token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token),
      ),
    ),
  ].slice(0, 8);
  if (tokens.length === 0) {
    return null;
  }
  return `{title} : (${tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" OR ")})`;
}

/**
 * Admin-scope title match after a view-as refusal: active-catalog documents whose
 * title matches the question, with NO ACL filter, so the admin sees that a document
 * exists that the assumed person cannot read. Private-owner documents are excluded.
 * Title and readers label only. The result never enters model context or a log.
 */
export async function adminTitleMatch(
  corpus: CorpusSql,
  question: string,
): Promise<AdminDiagnosticMatch[]> {
  const match = titleQuery(question);
  if (!match) {
    return [];
  }
  const generationId = await activeGenerationId(corpus as unknown as SqlExecutor);
  if (!generationId) {
    return [];
  }
  const rows = await corpus
    .prepare(
      `SELECT c.title AS title, c.access_scope AS access_scope,
              c.allowed_roles AS allowed_roles, c.allowed_departments AS allowed_departments
       FROM document_catalog_fts f
       JOIN document_catalog c ON c.id = f.rowid
       WHERE document_catalog_fts MATCH ? AND c.generation_id = ? AND c.access_scope <> 'private'
       ORDER BY bm25(document_catalog_fts), c.document_id
       LIMIT ?`,
    )
    .bind(match, generationId, MAX_DIAGNOSTIC_MATCHES)
    .all<{
      title: string;
      access_scope: string;
      allowed_roles: string;
      allowed_departments: string;
    }>();
  return rows.results.map((row) => ({ title: row.title, readers: readersOf(row) }));
}

export function citedDocumentIds(response: Pick<GroundedAnswerResponse, "retrieval">): string[] {
  return response.retrieval.results.flatMap((item) => (item.documentId ? [item.documentId] : []));
}

/** Audit primary key derived from the full request id, so distinct ids never collide. */
async function viewAsAuditId(requestId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(requestId));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `view-as-${hex}`;
}
