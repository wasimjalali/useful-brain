import type { DirectoryRecord } from "../../../../src/lib/auth/principal";
import { countReadableDocuments } from "../../../../src/lib/acl/access";
import { parseBoundedId } from "../../../../src/lib/cf/bounded-id";
import { writeOperationalLog } from "../../../../src/lib/cf/operational-log";
import { withRequestId } from "../../../../src/lib/cf/request-id";
import { normalizeTurnStage, type TurnProgress } from "../../../../src/lib/cf/turn-progress";
import {
  WorkerNotFoundError,
  WorkerValidationError,
} from "../../../../src/lib/cf/worker-errors";
import {
  DOCUMENT_REQUEST_MAX_CHARS,
  DOCUMENT_REQUEST_MIN_CHARS,
  type DocumentRequestResponse,
} from "../../../../src/lib/contracts/document-requests";
import {
  FEEDBACK_VALUES,
  type FeedbackValue,
  type RequestDocumentResponse,
  type SuggestionsResponse,
} from "../../../../src/lib/contracts/chat";
import { activeGenerationId, type SqlExecutor } from "../../../../src/lib/store/corpus-d1";
import {
  loadParentQuestion,
  normalizeRequestQuestion,
  recordDocumentRequest,
} from "../../../../src/lib/store/document-requests";
import {
  deleteFeedback,
  loadOwnedAssistantMessage,
  upsertFeedback,
} from "../../../../src/lib/store/feedback";
import type { OperationsDatabase } from "../../../../src/lib/store/conversations";
import { loadSuggestions } from "../../../../src/lib/store/suggestions";

/** The slice of the Brain env the chat routes read. */
export type ChatRouteEnv = {
  OPERATIONS_DB: unknown;
  CORPUS_DB?: unknown;
  CONVERSATION: {
    getByName(name: string): {
      progress(): Promise<{
        runId: string | null;
        stage: "searching" | "reading" | "writing" | null;
        count: number | null;
      }>;
    };
  };
};

const operations = (env: ChatRouteEnv) => env.OPERATIONS_DB as OperationsDatabase;

function principalOf(principal: DirectoryRecord) {
  return { userId: principal.id, roles: principal.roles, departments: principal.departments };
}

/**
 * Documents the asker can read in the active generation, or 0 with no corpus.
 * Same ACL predicate as retrieval and whoami; never the corpus total.
 */
async function readableDocumentsFor(env: ChatRouteEnv, principal: DirectoryRecord): Promise<number> {
  if (!env.CORPUS_DB) {
    return 0;
  }
  const corpus = env.CORPUS_DB as SqlExecutor;
  const generationId = await activeGenerationId(corpus);
  return generationId ? countReadableDocuments(corpus, generationId, principalOf(principal)) : 0;
}

/**
 * Progress payload for a pending turn. The stage comes from the conversation
 * lock only while the lock still belongs to this run; otherwise it reports
 * "searching" with the asker's readable count. A lock row that has no valid
 * count (written by an older build) falls back the same way.
 */
export async function pendingTurnProgress(
  env: ChatRouteEnv,
  principal: DirectoryRecord,
  handle: { conversationId: string; runId: string },
): Promise<TurnProgress> {
  const lock = await env.CONVERSATION.getByName(handle.conversationId).progress();
  const stage = lock.runId === handle.runId ? normalizeTurnStage(lock.stage) : null;
  if (stage === "writing") {
    return { stage: "writing" };
  }
  if (stage === "reading" && lock.count !== null) {
    return { stage: "reading", passages: lock.count };
  }
  if (stage === "searching" && lock.count !== null) {
    return { stage: "searching", readableDocuments: lock.count };
  }
  return { stage: "searching", readableDocuments: await readableDocumentsFor(env, principal) };
}

/**
 * Resolves POST /turns { retryOfMessageId }. 404 for an unknown message or one
 * the caller does not own (same answer for both). A message the caller owns
 * that has not failed is a 400. The question is the saved user message; the
 * conversation is the original one.
 */
export async function resolveTurnRetry(
  env: ChatRouteEnv,
  principal: DirectoryRecord,
  retryOfMessageId: unknown,
): Promise<{ question: string; conversationId: string; userMessageId: string }> {
  if (typeof retryOfMessageId !== "string") {
    throw new WorkerValidationError();
  }
  const messageId = parseBoundedId(retryOfMessageId, "message id");
  const row = await operations(env)
    .prepare(
      `SELECT a.status, a.conversation_id, a.parent_user_message_id, u.content
       FROM messages a
       JOIN conversations c ON c.id = a.conversation_id AND c.owner_principal_id = ?
       LEFT JOIN messages u
         ON u.id = a.parent_user_message_id AND u.role = 'user' AND u.conversation_id = a.conversation_id
       WHERE a.id = ? AND a.role = 'assistant'`,
    )
    .bind(principal.id, messageId)
    .first<{
      status: string;
      conversation_id: string;
      parent_user_message_id: string | null;
      content: string | null;
    }>();
  if (!row) {
    throw new WorkerNotFoundError();
  }
  if (row.status !== "failed" || !row.parent_user_message_id || !row.content) {
    throw new WorkerValidationError();
  }
  return {
    question: row.content,
    conversationId: row.conversation_id,
    userMessageId: row.parent_user_message_id,
  };
}

type ChatRouteContext = {
  request: Request;
  path: string;
  env: ChatRouteEnv;
  principal: DirectoryRecord;
  requestId: string;
  started: number;
};

function jsonResponse(body: unknown, requestId: string): Response {
  const response = Response.json(body, { headers: withRequestId(new Headers(), requestId) });
  response.headers.set("cache-control", "no-store");
  return response;
}

function parseFeedbackValue(body: unknown): FeedbackValue {
  const value =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { value?: unknown }).value
      : undefined;
  if (typeof value !== "string" || !(FEEDBACK_VALUES as readonly string[]).includes(value)) {
    throw new WorkerValidationError();
  }
  return value as FeedbackValue;
}

/** The question of a free-text document request: a string of 3 to 300 characters once whitespace is collapsed. */
function parseDocumentRequestQuestion(body: unknown): string {
  const question =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { question?: unknown }).question
      : undefined;
  if (typeof question !== "string") {
    throw new WorkerValidationError();
  }
  const collapsed = question.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (collapsed.length < DOCUMENT_REQUEST_MIN_CHARS || collapsed.length > DOCUMENT_REQUEST_MAX_CHARS) {
    throw new WorkerValidationError();
  }
  return normalizeRequestQuestion(collapsed);
}

/** Chat routes. Returns null when the path is not one of them. */
export async function handleChatRoute(context: ChatRouteContext): Promise<Response | null> {
  const { request, path, env, principal, requestId, started } = context;
  const log = (operation: string) =>
    writeOperationalLog({
      requestId,
      principalKind: principal.kind,
      operation,
      status: "ok",
      durationMs: Date.now() - started,
    });

  if (path === "/suggestions" && request.method === "GET") {
    let suggestions: SuggestionsResponse["suggestions"] = [];
    if (env.CORPUS_DB) {
      const corpus = env.CORPUS_DB as SqlExecutor;
      const generationId = await activeGenerationId(corpus);
      if (generationId) {
        suggestions = await loadSuggestions(corpus, generationId, principalOf(principal));
      }
    }
    log("suggestions");
    return jsonResponse({ suggestions } satisfies SuggestionsResponse, requestId);
  }

  const feedbackMatch = path.match(/^\/messages\/([^/]+)\/feedback$/);
  if (feedbackMatch && (request.method === "POST" || request.method === "DELETE")) {
    const messageId = parseBoundedId(feedbackMatch[1], "message id");
    let value: FeedbackValue | null = null;
    if (request.method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new WorkerValidationError();
      }
      value = parseFeedbackValue(body);
    }
    const message = await loadOwnedAssistantMessage(operations(env), messageId, principal.id);
    if (!message || message.status !== "completed") {
      throw new WorkerNotFoundError();
    }
    if (value) {
      await upsertFeedback(operations(env), {
        messageId,
        principalId: principal.id,
        value,
        now: Date.now(),
      });
      log("message-feedback");
      return jsonResponse({ value }, requestId);
    }
    await deleteFeedback(operations(env), { messageId, principalId: principal.id });
    log("message-feedback-delete");
    return jsonResponse({ ok: true }, requestId);
  }

  if (path === "/document-requests" && request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new WorkerValidationError();
    }
    await recordDocumentRequest(operations(env), {
      principalId: principal.id,
      messageId: null,
      questionNormalized: parseDocumentRequestQuestion(body),
      now: Date.now(),
    });
    log("document-request");
    return jsonResponse({ requested: true } satisfies DocumentRequestResponse, requestId);
  }

  const requestDocumentMatch = path.match(/^\/messages\/([^/]+)\/request-document$/);
  if (requestDocumentMatch && request.method === "POST") {
    const messageId = parseBoundedId(requestDocumentMatch[1], "message id");
    const message = await loadOwnedAssistantMessage(operations(env), messageId, principal.id);
    if (!message || message.status !== "completed") {
      throw new WorkerNotFoundError();
    }
    if (message.answerType !== "insufficient_evidence") {
      throw new WorkerValidationError();
    }
    const question = await loadParentQuestion(operations(env), message.parentUserMessageId);
    const questionNormalized = question ? normalizeRequestQuestion(question) : "";
    if (!questionNormalized) {
      throw new WorkerValidationError();
    }
    await recordDocumentRequest(operations(env), {
      principalId: principal.id,
      messageId,
      questionNormalized,
      now: Date.now(),
    });
    log("request-document");
    return jsonResponse({ requested: true } satisfies RequestDocumentResponse, requestId);
  }

  return null;
}
