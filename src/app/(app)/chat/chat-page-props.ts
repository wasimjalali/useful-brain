import { askGroundedQuestion, cancelGroundedQuestionAction } from "@/app/actions";
import {
  decideApprovalAction,
  loadConversationViewAction,
  loadDocumentAction,
  loadSuggestionsAction,
  requestDocumentAction,
  setFeedbackAction,
  startApprovalAction,
} from "@/app/chat-actions";
import type { ChatActions } from "@/components/chat/chat-view";
import type { SuggestionView } from "@/lib/contracts/chat-view";

/** Everything the chat client calls. Both chat routes pass the same set. */
export const chatPageProps = {
  askAction: askGroundedQuestion,
  cancelAction: cancelGroundedQuestionAction,
  actions: {
    setFeedback: setFeedbackAction,
    requestDocument: requestDocumentAction,
    loadDocument: loadDocumentAction,
    loadConversation: loadConversationViewAction,
    startApproval: startApprovalAction,
    decideApproval: decideApprovalAction,
  } satisfies ChatActions,
};

/**
 * Starter questions the asker can read. A Brain failure shows none rather
 * than a made-up list; the composer still works.
 */
export async function loadChatSuggestions(): Promise<SuggestionView[]> {
  const result = await loadSuggestionsAction();
  return result.ok
    ? result.data.map((suggestion) => ({ question: suggestion.text, department: suggestion.department }))
    : [];
}
