import type { ChatTurnExtras } from "@/lib/contracts/chat";
import type { AdminDiagnosticMatch, AssumedPersonEcho } from "@/lib/contracts/turn";
import type { AppErrorCode } from "@/lib/rag/app-errors";
import type { ChatTurn } from "@/lib/rag/chat-history";

/** One question and its outcome, plus everything the stored message adds. */
export type ChatTurnState = ChatTurn &
  Partial<ChatTurnExtras> & {
    /** Id of the failed assistant message, when the server told us. */
    messageId?: string;
    /** Code of the failure that replaced the answer, when the server gave one. */
    errorCode?: AppErrorCode;
    assumedPerson?: AssumedPersonEcho;
    adminDiagnostic?: AdminDiagnosticMatch[];
  };

/** Server id of the assistant message behind a turn, or null for a turn Brain never stored. */
export function messageIdOf(turn: ChatTurnState): string | null {
  return turn.answer?.assistantMessageId ?? turn.messageId ?? null;
}

export function isFailedTurn(turn: ChatTurnState): boolean {
  return turn.answer === null;
}
