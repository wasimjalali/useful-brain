import {
  addSyntheticDocumentAction,
  askGroundedQuestion,
  cancelGroundedQuestionAction,
  deleteConversationAction,
  deleteKnowledgeDocumentAction,
  embedSyntheticDocumentsAction,
  importLegacyConversationsAction,
  loadConversationAction,
  loadWorkspaceSnapshot,
  promoteCorpusVersionAction,
  reindexKnowledgeAction,
} from "@/app/actions";
import { RagVisibilityDashboard } from "@/components/rag-visibility-dashboard";
import type { WorkspaceView } from "@/components/workspace/workspace-shell";

export async function WorkspacePage({
  addDocument = false,
  conversationId,
  view,
}: {
  addDocument?: boolean;
  conversationId?: string;
  view: WorkspaceView;
}) {
  const [snapshot, conversationResult] = await Promise.all([
    loadWorkspaceSnapshot(),
    conversationId ? loadConversationAction(conversationId) : null,
  ]);
  const conversation = conversationResult?.ok ? conversationResult.data : null;
  const conversationError =
    conversationResult && !conversationResult.ok
      ? conversationResult.error.message
      : null;

  return (
    <RagVisibilityDashboard
      addDocumentAction={addSyntheticDocumentAction}
      askAction={askGroundedQuestion}
      cancelAction={cancelGroundedQuestionAction}
      chunks={snapshot.chunks}
      deleteConversationAction={deleteConversationAction}
      deleteDocumentAction={deleteKnowledgeDocumentAction}
      documents={snapshot.documents}
      embedAction={embedSyntheticDocumentsAction}
      embeddingStorageStatus={snapshot.embeddingStorageStatus}
      identity={snapshot.identity}
      importLegacyConversationsAction={importLegacyConversationsAction}
      initialAddDocument={addDocument}
      initialConversation={conversation}
      initialConversations={snapshot.conversations}
      initialEvalRuns={snapshot.evalRuns}
      initialView={view}
      key={`${view}:${conversationId ?? "new"}:${addDocument ? "add" : "view"}`}
      promoteCorpusAction={promoteCorpusVersionAction}
      reindexAction={reindexKnowledgeAction}
      retrievalMode={snapshot.retrievalMode}
      workspaceError={snapshot.error ?? conversationError}
    />
  );
}
