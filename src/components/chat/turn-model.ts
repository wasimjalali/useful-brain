import type { ChatTurnExtras } from "@/lib/contracts/chat";
import type { AdminDiagnosticMatch, AssumedPersonEcho } from "@/lib/contracts/turn";
import type { ChatTurn } from "@/lib/rag/chat-history";

/** One question and its outcome, plus everything the stored message adds. */
export type ChatTurnState = ChatTurn &
  Partial<ChatTurnExtras> & {
    /** Id of the failed assistant message, when the server told us. */
    messageId?: string;
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
