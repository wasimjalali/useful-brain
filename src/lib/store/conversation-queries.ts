import type {
  ChatEvidenceRow,
  ChatTurnView,
  ConversationAnswerType,
  ConversationView,
  FeedbackValue,
} from "../contracts/chat";
import type { ApprovalView } from "../contracts/approvals";
import type { Conversation } from "../rag/chat-history";
import type { GroundedAnswerResponse } from "../rag/grounded-answer";
import type { SqlExecutor } from "./corpus-d1";
import { loadApprovalViewForMessage } from "./approval-view";
import { normalizeRequestQuestion } from "./document-requests";
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
  latency_ms: number | null;
  passages_retrieved: number | null;
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
  generation_id: string | null;
  vector_score: number | null;
  keyword_score: number | null;
  fused_score: number | null;
  rerank_score: number | null;
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

const ANSWER_TYPES: readonly string[] = [
  "grounded",
  "insufficient_evidence",
  "unavailable",
  "must_retrieve",
  "invalid_citation",
] satisfies ConversationAnswerType[];

const IN_LIST_BATCH = 90;

/**
 * Titles from the document catalog for the documents an answer cited, keyed
 * `generation|document`. Titles only: evidence text always comes from the
 * stored snapshot. A missing catalog or row simply yields no title.
 */
async function loadDocumentTitles(
  corpus: SqlExecutor | undefined,
  evidence: Iterable<EvidenceRow>,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  if (!corpus) {
    return titles;
  }
  const idsByGeneration = new Map<string, Set<string>>();
  for (const row of evidence) {
    if (row.document_id && row.generation_id) {
      const ids = idsByGeneration.get(row.generation_id) ?? new Set<string>();
      ids.add(row.document_id);
      idsByGeneration.set(row.generation_id, ids);
    }
  }
  for (const [generationId, idSet] of idsByGeneration) {
    const ids = [...idSet];
    for (let start = 0; start < ids.length; start += IN_LIST_BATCH) {
      const batch = ids.slice(start, start + IN_LIST_BATCH);
      const rows = await corpus
        .prepare(
          `SELECT document_id, title FROM document_catalog
           WHERE generation_id = ? AND document_id IN (${batch.map(() => "?").join(",")})`,
        )
        .bind(generationId, ...batch)
        .all<{ document_id: string; title: string }>();
      for (const row of rows.results) {
        titles.set(`${generationId}|${row.document_id}`, row.title);
      }
    }
  }
  return titles;
}

export async function loadConversationForUi(
  db: OperationsDatabase,
  conversationId: string,
  ownerPrincipalId: string,
  corpus?: SqlExecutor,
  /** Scores, generation id and chunk ids reach only an admin viewer; the default hides them. */
  options: { diagnostics?: boolean } = {},
): Promise<ConversationView> {
  const diagnostics = options.diagnostics === true;
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
              retrieval_config_version, latency_ms, passages_retrieved, created_at
       FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at ASC, id ASC`,
    )
    .bind(conversationId)
    .all<AssistantRow>();
  const completed = assistants.results.filter(
    (assistant) => assistant.status === "completed" && assistant.parent_user_message_id,
  );
  // One batched evidence read for all completed turns replaces the previous
  // per-turn evidence_snapshots query (N+1). SQL keeps the 100-variable
  // D1 bound-parameter budget intact through chunked IN lists; rank ordering
  // within each message is preserved for the UI.
  const evidenceByMessage = new Map<string, EvidenceRow[]>();
  const EVIDENCE_BATCH = 90;
  for (let start = 0; start < completed.length; start += EVIDENCE_BATCH) {
    const batch = completed.slice(start, start + EVIDENCE_BATCH);
    const placeholders = batch.map(() => "?").join(",");
    const evidenceRows = await db
      .prepare(
        `SELECT message_id, rank, score, chunk_id, source, section, text, token_estimate,
                citation_label, document_id, generation_id, vector_score, keyword_score, fused_score, rerank_score
         FROM evidence_snapshots WHERE message_id IN (${placeholders})
         ORDER BY message_id ASC, rank ASC`,
      )
      .bind(...batch.map((assistant) => assistant.id))
      .all<EvidenceRow & { message_id: string }>();
    for (const row of evidenceRows.results) {
      const list = evidenceByMessage.get(row.message_id) ?? [];
      list.push(row);
      evidenceByMessage.set(row.message_id, list);
    }
  }
  const documentTitles = await loadDocumentTitles(
    corpus,
    [...evidenceByMessage.values()].flat(),
  );
  const byId = new Map(messages.results.map((row) => [row.id, row]));
  // The caller's own feedback, and whether a document was already requested
  // for the same normalized question (a request covers every ask of it).
  const feedbackByMessage = new Map<string, FeedbackValue>();
  const requestedQuestions = new Set<string>();
  const completedIds = completed.map((assistant) => assistant.id);
  for (let start = 0; start < completedIds.length; start += IN_LIST_BATCH) {
    const batch = completedIds.slice(start, start + IN_LIST_BATCH);
    const feedbackRows = await db
      .prepare(
        `SELECT message_id, value FROM message_feedback
         WHERE principal_id = ? AND message_id IN (${batch.map(() => "?").join(",")})`,
      )
      .bind(ownerPrincipalId, ...batch)
      .all<{ message_id: string; value: FeedbackValue }>();
    for (const row of feedbackRows.results) {
      feedbackByMessage.set(row.message_id, row.value);
    }
  }
  // Proposed actions of the caller's own assistant messages. One indexed read
  // finds the messages that have a run; the owner-only view is loaded for those.
  const approvalByMessage = new Map<string, ApprovalView>();
  for (let start = 0; start < completedIds.length; start += IN_LIST_BATCH) {
    const batch = completedIds.slice(start, start + IN_LIST_BATCH);
    const withRuns = await db
      .prepare(
        `SELECT DISTINCT r.evidence_message_id AS id FROM agent_runs r
         JOIN approvals a ON a.run_id = r.id
         WHERE r.principal_id = ? AND r.evidence_message_id IN (${batch.map(() => "?").join(",")})`,
      )
      .bind(ownerPrincipalId, ...batch)
      .all<{ id: string }>();
    for (const row of withRuns.results) {
      const view = await loadApprovalViewForMessage(db, row.id, { id: ownerPrincipalId });
      if (view) {
        approvalByMessage.set(row.id, view);
      }
    }
  }
  const insufficientQuestions = [
    ...new Set(
      completed
        .filter((assistant) => assistant.answer_type === "insufficient_evidence")
        .map((assistant) => byId.get(assistant.parent_user_message_id ?? ""))
        .filter((parent) => parent?.role === "user")
        .map((parent) => normalizeRequestQuestion(parent?.content ?? ""))
        .filter(Boolean),
    ),
  ];
  for (let start = 0; start < insufficientQuestions.length; start += IN_LIST_BATCH) {
    const batch = insufficientQuestions.slice(start, start + IN_LIST_BATCH);
    const requestRows = await db
      .prepare(
        `SELECT question_normalized FROM document_requests
         WHERE principal_id = ? AND question_normalized IN (${batch.map(() => "?").join(",")})`,
      )
      .bind(ownerPrincipalId, ...batch)
      .all<{ question_normalized: string }>();
    for (const row of requestRows.results) {
      requestedQuestions.add(row.question_normalized);
    }
  }
  // Attempts at one saved user message collapse to one: the newest completed
  // answer, else the newest failed one. A pending attempt (in flight, or stuck)
  // never hides a failed attempt, so its Retry stays reachable.
  const bestAttempt = new Map<string, AssistantRow>();
  for (const assistant of assistants.results) {
    const parentId = assistant.parent_user_message_id;
    if (!parentId || (assistant.status !== "completed" && assistant.status !== "failed")) {
      continue;
    }
    const best = bestAttempt.get(parentId);
    const better =
      !best ||
      (assistant.status === "completed" && best.status === "failed") ||
      (assistant.status === best.status &&
        (assistant.created_at > best.created_at ||
          (assistant.created_at === best.created_at && assistant.id > best.id)));
    if (better) {
      bestAttempt.set(parentId, assistant);
    }
  }
  const supersededIds = new Set(
    assistants.results
      .filter(
        (assistant) =>
          assistant.parent_user_message_id &&
          (assistant.status === "completed" || assistant.status === "failed") &&
          bestAttempt.get(assistant.parent_user_message_id)?.id !== assistant.id,
      )
      .map((assistant) => assistant.id),
  );
  const turns: ChatTurnView[] = [];
  for (const assistant of assistants.results) {
    const parent = assistant.parent_user_message_id
      ? byId.get(assistant.parent_user_message_id)
      : null;
    const question = parent?.role === "user" ? parent.content : "";
    if (!question) {
      continue;
    }
    if (supersededIds.has(assistant.id)) {
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
        answerType: null,
        latencyMs: null,
        passagesRetrieved: null,
        feedback: null,
        documentRequested: false,
      });
      continue;
    }
    if (assistant.status !== "completed") {
      continue;
    }
    const evidence = {
      results: evidenceByMessage.get(assistant.id) ?? [],
    };
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
    const storedAnswerType = ANSWER_TYPES.includes(assistant.answer_type ?? "")
      ? (assistant.answer_type as ConversationAnswerType)
      : null;
    const completedTurn: ChatTurnView = {
      id: assistant.id,
      answerType: storedAnswerType,
      latencyMs: assistant.latency_ms,
      passagesRetrieved: assistant.passages_retrieved,
      feedback: feedbackByMessage.get(assistant.id) ?? null,
      documentRequested:
        assistant.answer_type === "insufficient_evidence" &&
        requestedQuestions.has(normalizeRequestQuestion(question)),
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
            score: diagnostics ? item.score : 0,
            chunkId: diagnostics ? item.chunk_id : `${assistant.id}:${item.rank}`,
            source: item.source,
            section: item.section,
            text: item.text,
            tokenEstimate: item.token_estimate,
            citationLabel: item.citation_label,
            documentId: item.document_id,
            documentTitle:
              item.document_id && item.generation_id
                ? (documentTitles.get(`${item.generation_id}|${item.document_id}`) ?? null)
                : null,
            vectorScore: diagnostics ? item.vector_score : null,
            keywordScore: diagnostics ? item.keyword_score : null,
            fusedScore: diagnostics ? item.fused_score : null,
            rerankScore: diagnostics ? item.rerank_score : null,
          })) satisfies ChatEvidenceRow[],
        },
        conversationId,
        assistantMessageId: assistant.id,
        corpusGenerationId: diagnostics ? assistant.corpus_generation_id : null,
        retrievalConfigVersion: assistant.retrieval_config_version,
      },
      error: null,
    };
    const approval = approvalByMessage.get(assistant.id);
    if (approval) {
      completedTurn.approval = approval;
    }
    turns.push(completedTurn);
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
        answerType: null,
        latencyMs: null,
        passagesRetrieved: null,
        feedback: null,
        documentRequested: false,
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
        `DELETE FROM message_feedback WHERE message_id IN (
           SELECT id FROM messages WHERE conversation_id = ?
         )`,
      )
      .bind(conversationId),
    db
      .prepare(
        `UPDATE document_requests SET message_id = NULL WHERE message_id IN (
           SELECT id FROM messages WHERE conversation_id = ?
         )`,
      )
      .bind(conversationId),
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
    db
      .prepare(
        `DELETE FROM turn_steps WHERE message_id IN (
           SELECT id FROM messages WHERE conversation_id = ?
         )`,
      )
      .bind(conversationId),
    db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).bind(conversationId),
    db
      .prepare(`DELETE FROM conversations WHERE id = ? AND owner_principal_id = ?`)
      .bind(conversationId, ownerPrincipalId),
  ]);
}
