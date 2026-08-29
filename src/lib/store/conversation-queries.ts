import type { Conversation, ChatTurn } from "../rag/chat-history";
import type { GroundedAnswerResponse } from "../rag/grounded-answer";
import {
  assertConversationOwner,
  ConversationStoreError,
  pairCompletedHistoryTurns,
  type OperationsDatabase,
  type HistoryMessageRow,
} from "./conversations";

type ConversationRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

type AssistantRow = {
  id: string;
  content: string;
  status: string;
  answer_type: string | null;
  answer_model: string | null;
  embedding_model: string | null;
  embedding_dimensions: number | null;
  structured_paragraphs_json: string | null;
  error_code: string | null;
  parent_user_message_id: string | null;
  corpus_generation_id: string | null;
  retrieval_config_version: string | null;
  created_at: number;
};

type EvidenceRow = {
  rank: number;
  score: number;
  chunk_id: string;
  source: string;
  section: string;
  text: string;
  token_estimate: number;
  citation_label: string;
  document_id: string | null;
};

export async function listRecentConversations(
  db: OperationsDatabase,
  ownerPrincipalId: string,
  limit = 30,
): Promise<Array<Pick<Conversation, "id" | "title" | "createdAt" | "updatedAt">>> {
  const rows = await db
    .prepare(
      `SELECT id, title, created_at, updated_at
       FROM conversations
       WHERE owner_principal_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(ownerPrincipalId, limit)
    .all<ConversationRow>();
  return rows.results.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function loadConversationForUi(
  db: OperationsDatabase,
  conversationId: string,
  ownerPrincipalId: string,
): Promise<Conversation> {
  await assertConversationOwner(db, conversationId, ownerPrincipalId);
  const header = await db
    .prepare(
      `SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?`,
    )
    .bind(conversationId)
    .first<ConversationRow>();
  if (!header) {
    throw new ConversationStoreError("FORBIDDEN");
  }
  const messages = await db
    .prepare(
      `SELECT id, role, content, status, parent_user_message_id, created_at
       FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .bind(conversationId)
    .all<HistoryMessageRow & { created_at: number }>();
  const assistants = await db
    .prepare(
      `SELECT id, content, status, answer_type, answer_model, embedding_model, embedding_dimensions,
              structured_paragraphs_json, error_code, parent_user_message_id, corpus_generation_id,
              retrieval_config_version, created_at
       FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at ASC, id ASC`,
    )
    .bind(conversationId)
    .all<AssistantRow>();
  const byId = new Map(messages.results.map((row) => [row.id, row]));
  const turns: ChatTurn[] = [];
  for (const assistant of assistants.results) {
    const parent = assistant.parent_user_message_id
      ? byId.get(assistant.parent_user_message_id)
      : null;
    const question = parent?.role === "user" ? parent.content : "";
    if (!question) {
      continue;
    }
    if (assistant.status === "failed") {
      const cancelled = assistant.error_code === "CANCELLED";
      turns.push({
        id: assistant.id,
        question,
        answer: null,
        error: cancelled ? null : "The previous answer could not be completed.",
        errorRetryable:
          assistant.error_code === "RATE_LIMITED" || assistant.error_code === "PROVIDER_TEMPORARY",
        cancelled,
      });
      continue;
    }
    if (assistant.status !== "completed") {
      continue;
    }
    const evidence = await db
      .prepare(
        `SELECT rank, score, chunk_id, source, section, text, token_estimate, citation_label, document_id
         FROM evidence_snapshots WHERE message_id = ? ORDER BY rank ASC`,
      )
      .bind(assistant.id)
      .all<EvidenceRow>();
    let paragraphs: GroundedAnswerResponse["structuredAnswer"]["paragraphs"] = [];
    if (assistant.structured_paragraphs_json) {
      try {
        const parsed: unknown = JSON.parse(assistant.structured_paragraphs_json);
        if (Array.isArray(parsed)) {
          paragraphs = parsed as GroundedAnswerResponse["structuredAnswer"]["paragraphs"];
        }
      } catch {
        paragraphs = [];
      }
    }
    const answerType =
      assistant.answer_type === "grounded" ? "grounded" : "insufficient_evidence";
    turns.push({
      id: assistant.id,
      question,
      answer: {
        question,
        answer: assistant.content,
        answerModel: assistant.answer_model ?? "unknown",
        structuredAnswer: { answerType, paragraphs },
        retrieval: {
          embeddingModel: assistant.embedding_model ?? "unknown",
          embeddingDimensions: assistant.embedding_dimensions ?? 0,
          results: evidence.results.map((item) => ({
            rank: item.rank,
            score: item.score,
            chunkId: item.chunk_id,
            source: item.source,
            section: item.section,
            text: item.text,
            tokenEstimate: item.token_estimate,
            citationLabel: item.citation_label,
            documentId: item.document_id,
          })),
        },
        conversationId,
        assistantMessageId: assistant.id,
        corpusGenerationId: assistant.corpus_generation_id,
        retrievalConfigVersion: assistant.retrieval_config_version,
      },
      error: null,
    });
  }
  if (turns.length === 0) {
    const paired = pairCompletedHistoryTurns(messages.results);
    for (const [index, pair] of paired.entries()) {
      turns.push({
        id: `${conversationId}-turn-${index}`,
        question: pair.question,
        answer: {
          question: pair.question,
          answer: pair.answer,
          answerModel: "unknown",
          structuredAnswer: { answerType: "insufficient_evidence", paragraphs: [] },
          retrieval: { embeddingModel: "unknown", embeddingDimensions: 0, results: [] },
          conversationId,
        },
        error: null,
      });
    }
  }
  return {
    id: header.id,
    title: header.title,
    createdAt: header.created_at,
    updatedAt: header.updated_at,
    turns,
  };
}

export async function deleteConversation(
  db: OperationsDatabase,
  conversationId: string,
  ownerPrincipalId: string,
): Promise<void> {
  await assertConversationOwner(db, conversationId, ownerPrincipalId);
  await db.prepare("PRAGMA foreign_keys = ON").run();
  await db.batch([
    db
      .prepare(
        `DELETE FROM evidence_snapshots WHERE message_id IN (
           SELECT id FROM messages WHERE conversation_id = ?
         )`,
      )
      .bind(conversationId),
    db
      .prepare(
        `DELETE FROM turn_completion_claims WHERE message_id IN (
           SELECT id FROM messages WHERE conversation_id = ?
         )`,
      )
      .bind(conversationId),
    db
      .prepare(
        `DELETE FROM tool_calls WHERE run_id IN (
           SELECT id FROM agent_runs WHERE conversation_id = ?
         )`,
      )
      .bind(conversationId),
    db.prepare(`DELETE FROM approvals WHERE conversation_id = ?`).bind(conversationId),
    db.prepare(`DELETE FROM agent_runs WHERE conversation_id = ?`).bind(conversationId),
    db.prepare(`DELETE FROM request_id_claims WHERE conversation_id = ?`).bind(conversationId),
    db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).bind(conversationId),
    db
      .prepare(`DELETE FROM conversations WHERE id = ? AND owner_principal_id = ?`)
      .bind(conversationId, ownerPrincipalId),
  ]);
}
