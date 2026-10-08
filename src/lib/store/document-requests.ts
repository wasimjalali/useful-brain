import { newBoundedId } from "./conversations";
import type { OperationsDatabase } from "./conversations";

export const MAX_NORMALIZED_QUESTION_CHARS = 300;

/**
 * NFKC, lowercase, collapsed whitespace, trimmed, at most 300 characters.
 * The one place a request question is derived; the client never supplies it.
 */
export function normalizeRequestQuestion(question: string): string {
  return question
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NORMALIZED_QUESTION_CHARS)
    .trim();
}

export async function loadParentQuestion(
  db: OperationsDatabase,
  parentUserMessageId: string | null,
): Promise<string | null> {
  if (!parentUserMessageId) {
    return null;
  }
  const row = await db
    .prepare(`SELECT content FROM messages WHERE id = ? AND role = 'user'`)
    .bind(parentUserMessageId)
    .first<{ content: string }>();
  return row?.content ?? null;
}

/** Idempotent per (principal, normalized question): a repeat changes nothing. */
export async function recordDocumentRequest(
  db: OperationsDatabase,
  input: { principalId: string; messageId: string | null; questionNormalized: string; now: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO document_requests (id, principal_id, message_id, question_normalized, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(principal_id, question_normalized) DO NOTHING`,
    )
    .bind(newBoundedId("dr"), input.principalId, input.messageId, input.questionNormalized, input.now)
    .run();
}
