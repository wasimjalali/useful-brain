import { parseBoundedId } from "../cf/bounded-id";
import { sha256Hex } from "../ingest/digests";
import {
  type CitedRetrievalResult,
  type StructuredGroundedAnswer,
  answerFromEvidence,
  buildInsufficientEvidenceAnswer,
  structuredAnswerToText,
} from "../answer/contract";

export const MAX_HISTORY_TURNS = 6;
export const MAX_HISTORY_CHARS = 6000;

export type StoredHistoryTurn = { question: string; answer: string };

export type OperationsStatement = {
  bind(...values: unknown[]): OperationsStatement;
  run(): Promise<{ meta?: { changes?: number } }>;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
};

export type OperationsDatabase = {
  prepare(query: string): OperationsStatement;
  batch(statements: OperationsStatement[]): Promise<unknown>;
};

export type ConversationAnswerType =
  | "grounded"
  | "insufficient_evidence"
  | "unavailable"
  | "must_retrieve"
  | "invalid_citation";

export type CompleteTurnInput = {
  ownerPrincipalId: string;
  requestId: string;
  rawModelJson: string;
  evidence: CitedRetrievalResult[];
  answerModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  promptVersion: string;
  retrievalConfigVersion: string;
  corpusGenerationId: string;
  now: number;
};

export type ReplayedTurn = {
  conversationId: string;
  assistantMessageId: string;
  question: string;
  answer: string;
  answerModel: string;
  structuredAnswer: StructuredGroundedAnswer;
  retrieval: {
    embeddingModel: string;
    embeddingDimensions: number;
    results: CitedRetrievalResult[];
  };
  promptVersion: string | null;
  retrievalConfigVersion: string | null;
  corpusGenerationId: string | null;
};

export class ConversationStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationStoreError";
  }
}

export function deriveServerConversationTitle(question: string) {
  const normalized = question.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "New chat";
  }
  return normalized.length > 60 ? `${normalized.slice(0, 59)}…` : normalized;
}

export function trimStoredHistory(
  history: StoredHistoryTurn[],
  maxTurns = MAX_HISTORY_TURNS,
  maxChars = MAX_HISTORY_CHARS,
) {
  const recent = history.slice(-maxTurns);
  const result: StoredHistoryTurn[] = [];
  let chars = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const turn = recent[index];
    const size = turn.question.length + turn.answer.length;
    if (result.length > 0 && chars + size > maxChars) {
      break;
    }
    result.unshift(turn);
    chars += size;
  }
  return result;
}

export function newBoundedId(prefix: string): string {
  return parseBoundedId(`${prefix}-${crypto.randomUUID()}`, prefix);
}

type MessageRow = {
  id: string;
  conversation_id: string;
  request_id: string | null;
  parent_user_message_id: string | null;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "completed" | "failed";
  answer_type: ConversationAnswerType | null;
  answer_model: string | null;
  embedding_model: string | null;
  embedding_dimensions: number | null;
  structured_paragraphs_json: string | null;
  prompt_version: string | null;
  retrieval_config_version: string | null;
  corpus_generation_id: string | null;
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

function isUniqueConstraintError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(text);
}

type RequestIdClaim = {
  request_id: string;
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  owner_principal_id: string;
};

async function loadRequestIdClaim(
  db: OperationsDatabase,
  requestId: string,
): Promise<RequestIdClaim | null> {
  return db
    .prepare(
      `SELECT request_id, conversation_id, user_message_id, assistant_message_id, owner_principal_id
       FROM request_id_claims WHERE request_id = ?`,
    )
    .bind(requestId)
    .first<RequestIdClaim>();
}

async function materializeClaimedTurn(
  db: OperationsDatabase,
  claim: RequestIdClaim,
  input: { question: string; now: number },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO conversations (id, owner_principal_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        claim.conversation_id,
        claim.owner_principal_id,
        deriveServerConversationTitle(input.question),
        input.now,
        input.now,
      ),
    db
      .prepare(
        `INSERT INTO messages (id, conversation_id, request_id, parent_user_message_id, role, content, status, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, 'user', ?, 'completed', ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(claim.user_message_id, claim.conversation_id, input.question, input.now, input.now),
    db
      .prepare(
        `INSERT INTO messages (id, conversation_id, request_id, parent_user_message_id, role, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'assistant', '', 'pending', ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        claim.assistant_message_id,
        claim.conversation_id,
        claim.request_id,
        claim.user_message_id,
        input.now + 1,
        input.now + 1,
      ),
    db
      .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
      .bind(input.now, claim.conversation_id),
  ]);
}

export async function createPendingTurn(
  db: OperationsDatabase,
  input: {
    ownerPrincipalId: string;
    conversationId?: string;
    requestId: string;
    question: string;
    now: number;
  },
): Promise<{ conversationId: string; assistantMessageId: string; duplicate: boolean }> {
  const ownerPrincipalId = parseBoundedId(input.ownerPrincipalId, "principal id");
  const requestId = parseBoundedId(input.requestId, "request id");
  const duplicate = await db
    .prepare(
      `SELECT id, conversation_id, status FROM messages WHERE request_id = ? AND role = 'assistant'`,
    )
    .bind(requestId)
    .first<{ id: string; conversation_id: string; status: string }>();
  if (duplicate) {
    await assertConversationOwner(db, duplicate.conversation_id, ownerPrincipalId);
    return {
      conversationId: duplicate.conversation_id,
      assistantMessageId: duplicate.id,
      duplicate: true,
    };
  }

  const existingClaim = await loadRequestIdClaim(db, requestId);
  if (existingClaim) {
    if (existingClaim.owner_principal_id !== ownerPrincipalId) {
      throw new ConversationStoreError("FORBIDDEN");
    }
    try {
      await materializeClaimedTurn(db, existingClaim, input);
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }
    await assertConversationOwner(db, existingClaim.conversation_id, ownerPrincipalId);
    return {
      conversationId: existingClaim.conversation_id,
      assistantMessageId: existingClaim.assistant_message_id,
      duplicate: true,
    };
  }

  let conversationId: string;
  if (input.conversationId) {
    conversationId = parseBoundedId(input.conversationId, "conversation id");
    await assertConversationOwner(db, conversationId, ownerPrincipalId);
  } else {
    conversationId = newBoundedId("c");
  }
  const userId = newBoundedId("m");
  const assistantMessageId = newBoundedId("m");
  await db
    .prepare(
      `INSERT INTO request_id_claims (
         request_id, conversation_id, user_message_id, assistant_message_id, owner_principal_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(request_id) DO NOTHING`,
    )
    .bind(requestId, conversationId, userId, assistantMessageId, ownerPrincipalId, input.now)
    .run();
  const winner = await loadRequestIdClaim(db, requestId);
  if (!winner) {
    throw new ConversationStoreError("request id claim is missing");
  }
  if (winner.owner_principal_id !== ownerPrincipalId) {
    throw new ConversationStoreError("FORBIDDEN");
  }
  try {
    await materializeClaimedTurn(db, winner, input);
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }
  const materialized = await db
    .prepare(`SELECT id, conversation_id FROM messages WHERE request_id = ? AND role = 'assistant'`)
    .bind(requestId)
    .first<{ id: string; conversation_id: string }>();
  if (materialized) {
    await assertConversationOwner(db, materialized.conversation_id, ownerPrincipalId);
    return {
      conversationId: materialized.conversation_id,
      assistantMessageId: materialized.id,
      duplicate: materialized.id !== assistantMessageId,
    };
  }
  await assertConversationOwner(db, winner.conversation_id, ownerPrincipalId);
  return {
    conversationId: winner.conversation_id,
    assistantMessageId: winner.assistant_message_id,
    duplicate: winner.assistant_message_id !== assistantMessageId,
  };
}

export async function completeTurn(
  db: OperationsDatabase,
  input: CompleteTurnInput & { assistantMessageId: string },
): Promise<ReplayedTurn> {
  const assistantMessageId = parseBoundedId(input.assistantMessageId, "message id");
  const existing = await loadReplay(db, assistantMessageId, input.ownerPrincipalId);
  if (existing) {
    return existing;
  }

  const pending = await db
    .prepare(
      `SELECT m.id, m.conversation_id, m.status, m.request_id
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = ? AND c.owner_principal_id = ?`,
    )
    .bind(assistantMessageId, parseBoundedId(input.ownerPrincipalId, "principal id"))
    .first<{ id: string; conversation_id: string; status: string; request_id: string | null }>();
  if (!pending || pending.status !== "pending") {
    throw new ConversationStoreError("assistant turn is not pending");
  }

  const structured = answerFromEvidence(input.rawModelJson, input.evidence);
  const content = structuredAnswerToText(structured);
  const completionDigest = await sha256Hex(
    JSON.stringify({
      assistantMessageId,
      ownerPrincipalId: input.ownerPrincipalId,
      content,
      structured,
      evidence: input.evidence,
      answerModel: input.answerModel,
      embeddingModel: input.embeddingModel,
      embeddingDimensions: input.embeddingDimensions,
      promptVersion: input.promptVersion,
      retrievalConfigVersion: input.retrievalConfigVersion,
      corpusGenerationId: input.corpusGenerationId,
    }),
  );
  const completionToken = parseBoundedId(
    `completion-${completionDigest.slice(0, 48)}`,
    "completion token",
  );
  await db
    .prepare(
      `INSERT INTO turn_completion_claims (message_id, completion_token, created_at)
       SELECT m.id, ?, ?
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = ? AND m.status = 'pending' AND c.owner_principal_id = ?
       ON CONFLICT(message_id) DO NOTHING`,
    )
    .bind(
      completionToken,
      input.now,
      assistantMessageId,
      parseBoundedId(input.ownerPrincipalId, "principal id"),
    )
    .run();
  const completionOwner = await db
    .prepare(
      `SELECT m.status, c.completion_token
       FROM messages m
       LEFT JOIN turn_completion_claims c ON c.message_id = m.id
       WHERE m.id = ?`,
    )
    .bind(assistantMessageId)
    .first<{ status: string; completion_token: string | null }>();
  if (
    !completionOwner ||
    completionOwner.status !== "pending" ||
    completionOwner.completion_token !== completionToken
  ) {
    const completed = await loadReplay(db, assistantMessageId, input.ownerPrincipalId);
    if (completed) {
      return completed;
    }
    throw new ConversationStoreError("assistant completion is owned by another writer");
  }
  const statements: OperationsStatement[] = [
    db
      .prepare(
        `UPDATE messages
         SET content = ?, status = 'completed', answer_type = ?, answer_model = ?,
             embedding_model = ?, embedding_dimensions = ?, structured_paragraphs_json = ?,
             prompt_version = ?, retrieval_config_version = ?, corpus_generation_id = ?,
             completion_token = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'
           AND conversation_id IN (
             SELECT id FROM conversations WHERE owner_principal_id = ?
           )
           AND EXISTS (
             SELECT 1 FROM turn_completion_claims
             WHERE message_id = ? AND completion_token = ?
           )`,
      )
      .bind(
        content,
        structured.answerType,
        input.answerModel,
        input.embeddingModel,
        input.embeddingDimensions,
        JSON.stringify(structured.paragraphs),
        input.promptVersion,
        input.retrievalConfigVersion,
        input.corpusGenerationId,
        completionToken,
        input.now,
        assistantMessageId,
        parseBoundedId(input.ownerPrincipalId, "principal id"),
        assistantMessageId,
        completionToken,
      ),
  ];
  for (const item of input.evidence) {
    statements.push(
      db
        .prepare(
          `INSERT INTO evidence_snapshots (
             message_id, rank, score, chunk_id, source, section, text, token_estimate,
             citation_label, document_id, generation_id
           ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM messages WHERE id = ? AND completion_token = ?
           )
           ON CONFLICT(message_id, rank) DO NOTHING`,
        )
        .bind(
          assistantMessageId,
          item.rank,
          item.score,
          item.chunkId,
          item.source,
          item.section,
          item.text,
          item.tokenEstimate,
          item.citationLabel,
          item.documentId ?? null,
          input.corpusGenerationId,
          assistantMessageId,
          completionToken,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE conversations SET updated_at = ?
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM messages WHERE id = ? AND completion_token = ?
         )`,
      )
      .bind(input.now, pending.conversation_id, assistantMessageId, completionToken),
  );
  await db.batch(statements);
  const replayed = await loadReplay(db, assistantMessageId, input.ownerPrincipalId);
  if (!replayed) {
    throw new ConversationStoreError("completed turn could not be replayed");
  }
  return replayed;
}

export async function failTurn(
  db: OperationsDatabase,
  input: { assistantMessageId: string; ownerPrincipalId: string; errorCode: string; now: number },
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE messages SET status = 'failed', error_code = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'
         AND conversation_id IN (
           SELECT id FROM conversations WHERE owner_principal_id = ?
         )`,
    )
    .bind(
      input.errorCode,
      input.now,
      parseBoundedId(input.assistantMessageId, "message id"),
      parseBoundedId(input.ownerPrincipalId, "principal id"),
    )
    .run();
  if ((result.meta?.changes ?? 0) !== 1) {
    throw new ConversationStoreError("FORBIDDEN");
  }
}

export async function loadReplay(
  db: OperationsDatabase,
  assistantMessageId: string,
  ownerPrincipalId: string,
): Promise<ReplayedTurn | null> {
  const message = await db
    .prepare(
      `SELECT m.id, m.conversation_id, m.request_id, m.parent_user_message_id, m.role, m.content, m.status, m.answer_type,
              m.answer_model, m.embedding_model, m.embedding_dimensions, m.structured_paragraphs_json,
              m.prompt_version, m.retrieval_config_version, m.corpus_generation_id, m.created_at
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = ? AND c.owner_principal_id = ?`,
    )
    .bind(
      parseBoundedId(assistantMessageId, "message id"),
      parseBoundedId(ownerPrincipalId, "principal id"),
    )
    .first<MessageRow>();
  if (!message || message.role !== "assistant" || message.status !== "completed") {
    return null;
  }

  const prior = message.parent_user_message_id
    ? await db
        .prepare(
          `SELECT role, content FROM messages
           WHERE id = ? AND conversation_id = ? AND role = 'user'`,
        )
        .bind(message.parent_user_message_id, message.conversation_id)
        .first<{ role: string; content: string }>()
    : await db
        .prepare(
          `SELECT role, content FROM messages
           WHERE conversation_id = ? AND created_at < ?
           ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .bind(message.conversation_id, message.created_at)
        .first<{ role: string; content: string }>();
  if (!prior || prior.role !== "user") {
    throw new ConversationStoreError("assistant turn is missing its question");
  }

  const evidence = await db
    .prepare(
      `SELECT rank, score, chunk_id, source, section, text, token_estimate, citation_label, document_id
       FROM evidence_snapshots WHERE message_id = ? ORDER BY rank ASC`,
    )
    .bind(message.id)
    .all<EvidenceRow>();

  let paragraphs: StructuredGroundedAnswer["paragraphs"] = [];
  if (message.structured_paragraphs_json) {
    try {
      const parsed: unknown = JSON.parse(message.structured_paragraphs_json);
      if (Array.isArray(parsed)) {
        paragraphs = parsed as StructuredGroundedAnswer["paragraphs"];
      }
    } catch {
      paragraphs = [];
    }
  }

  return {
    conversationId: message.conversation_id,
    assistantMessageId: message.id,
    question: prior.content,
    answer: message.content,
    answerModel: message.answer_model ?? "unknown",
    structuredAnswer: {
      answerType:
        message.answer_type === "grounded" ? "grounded" : "insufficient_evidence",
      paragraphs:
        paragraphs.length > 0
          ? paragraphs
          : buildInsufficientEvidenceAnswer().paragraphs,
    },
    retrieval: {
      embeddingModel: message.embedding_model ?? "unknown",
      embeddingDimensions: message.embedding_dimensions ?? 0,
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
    promptVersion: message.prompt_version,
    retrievalConfigVersion: message.retrieval_config_version,
    corpusGenerationId: message.corpus_generation_id,
  };
}

export async function loadBoundedHistory(
  db: OperationsDatabase,
  conversationId: string,
  ownerPrincipalId: string,
): Promise<StoredHistoryTurn[]> {
  await assertConversationOwner(
    db,
    parseBoundedId(conversationId, "conversation id"),
    parseBoundedId(ownerPrincipalId, "principal id"),
  );
  const rows = await db
    .prepare(
      `SELECT id, role, content, status, parent_user_message_id FROM messages
       WHERE conversation_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .bind(conversationId)
    .all<{
      id: string;
      role: string;
      content: string;
      status: string;
      parent_user_message_id: string | null;
    }>();
  const byId = new Map(rows.results.map((row) => [row.id, row]));
  const turns: StoredHistoryTurn[] = [];
  for (const row of rows.results) {
    if (row.role !== "assistant" || row.status !== "completed") {
      continue;
    }
    const parent = row.parent_user_message_id ? byId.get(row.parent_user_message_id) : undefined;
    if (!parent || parent.role !== "user") {
      continue;
    }
    turns.push({ question: parent.content, answer: row.content });
  }
  return trimStoredHistory(turns);
}

export async function persistThenRelease<T>(input: {
  persist: () => Promise<T>;
  release: () => Promise<{ ok: boolean }>;
}): Promise<T> {
  const result = await input.persist();
  const released = await input.release();
  if (!released.ok) {
    throw new ConversationStoreError("run lock could not be released after persist");
  }
  return result;
}

export async function assertConversationOwner(
  db: OperationsDatabase,
  conversationId: string,
  ownerPrincipalId: string,
): Promise<void> {
  const row = await db
    .prepare(`SELECT owner_principal_id FROM conversations WHERE id = ?`)
    .bind(conversationId)
    .first<{ owner_principal_id: string }>();
  if (!row || row.owner_principal_id !== ownerPrincipalId) {
    throw new ConversationStoreError("FORBIDDEN");
  }
}
