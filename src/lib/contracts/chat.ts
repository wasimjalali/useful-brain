/**
 * Chat turn contracts shared by the Brain Worker and the Next.js app.
 * Every union here is closed: a value outside it is a bug, not a new case.
 */
import type { CitedRetrievalResult } from "../answer/contract";
import type { ApprovalView } from "./approvals";
import type { ConversationAnswerType } from "../store/conversations";
import type { Conversation, ChatTurn } from "../rag/chat-history";

export type { TurnFailureCode, TurnProgress } from "../cf/turn-progress";
export type { ConversationAnswerType };

/** GET /turns/:requestId/progress. Counts are integers in 0..100000. */
export const TURN_PROGRESS_STAGES = ["searching", "reading", "writing", "done", "failed"] as const;

export const FEEDBACK_VALUES = ["up", "down"] as const;
export type FeedbackValue = (typeof FEEDBACK_VALUES)[number];

/** POST /messages/:id/feedback body. DELETE /messages/:id/feedback has no body. */
export type FeedbackBody = { value: FeedbackValue };
export type FeedbackResponse = { value: FeedbackValue };
export type FeedbackDeleteResponse = { ok: true };

/** POST /messages/:id/request-document has no body; the question is derived server-side. */
export type RequestDocumentResponse = { requested: true };

export type Suggestion = { text: string; department: string };
/** GET /suggestions: up to four, all drawn from documents the caller can read. */
export type SuggestionsResponse = { suggestions: Suggestion[] };

/**
 * POST /turns additions. `retryOfMessageId` is the id of the caller's failed
 * assistant message; the server re-runs the saved user message and ignores any
 * `question` or `conversationId` sent with it.
 */
export type TurnRequestBody = {
  question?: string;
  conversationId?: string;
  requestId?: string;
  retryOfMessageId?: string;
};

/** An evidence row in a stored conversation: the frozen snapshot plus its document. */
export type ChatEvidenceRow = CitedRetrievalResult & {
  documentId?: string | null;
  /** Title from the document catalog, or null when the catalog has no row. */
  documentTitle: string | null;
};

/** Per-turn additions on GET /conversations/:id (completed assistant messages). */
export type ChatTurnExtras = {
  /** Stored answer type, never collapsed. Null for failed turns. */
  answerType: ConversationAnswerType | null;
  latencyMs: number | null;
  passagesRetrieved: number | null;
  feedback: FeedbackValue | null;
  documentRequested: boolean;
  /** The proposed action of this message, owner-only. */
  approval?: ApprovalView;
};

export type ChatTurnView = ChatTurn & ChatTurnExtras;
export type ConversationView = Omit<Conversation, "turns"> & { turns: ChatTurnView[] };
