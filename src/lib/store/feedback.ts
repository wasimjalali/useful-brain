import type { FeedbackValue } from "../contracts/chat";
import { parseBoundedId } from "../cf/bounded-id";
import type { OperationsDatabase } from "./conversations";

export type OwnedAssistantMessage = {
  id: string;
  status: string;
  answerType: string | null;
  parentUserMessageId: string | null;
};

/**
 * Loads an assistant message only when it sits in a conversation the caller
 * owns. Unknown ids and other people's messages are the same null.
 */
export async function loadOwnedAssistantMessage(
  db: OperationsDatabase,
  messageIdInput: string,
  ownerPrincipalIdInput: string,
): Promise<OwnedAssistantMessage | null> {
  const messageId = parseBoundedId(messageIdInput, "message id");
  const ownerPrincipalId = parseBoundedId(ownerPrincipalIdInput, "principal id");
  const row = await db
    .prepare(
      `SELECT m.id, m.status, m.answer_type, m.parent_user_message_id
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = ? AND m.role = 'assistant' AND c.owner_principal_id = ?`,
    )
    .bind(messageId, ownerPrincipalId)
    .first<{ id: string; status: string; answer_type: string | null; parent_user_message_id: string | null }>();
  return row
    ? {
        id: row.id,
        status: row.status,
        answerType: row.answer_type,
        parentUserMessageId: row.parent_user_message_id,
      }
    : null;
}

export async function upsertFeedback(
  db: OperationsDatabase,
  input: { messageId: string; principalId: string; value: FeedbackValue; now: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO message_feedback (message_id, principal_id, value, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id, principal_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`,
    )
    .bind(input.messageId, input.principalId, input.value, input.now)
    .run();
}

export async function deleteFeedback(
  db: OperationsDatabase,
  input: { messageId: string; principalId: string },
): Promise<void> {
  await db
    .prepare(`DELETE FROM message_feedback WHERE message_id = ? AND principal_id = ?`)
    .bind(input.messageId, input.principalId)
    .run();
}
