import { RagVisibilityDashboard } from "@/components/rag-visibility-dashboard";
import {
  addSyntheticDocumentAction,
  askGroundedQuestion,
  deleteConversationAction,
  embedSyntheticDocumentsAction,
  loadConversationAction,
  importLegacyConversationsAction,
  loadWorkspaceSnapshot,
  promoteCorpusVersionAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await loadWorkspaceSnapshot();

  return (
    <RagVisibilityDashboard
      chunks={snapshot.chunks}
      documents={snapshot.documents}
      addDocumentAction={addSyntheticDocumentAction}
      embedAction={embedSyntheticDocumentsAction}
      askAction={askGroundedQuestion}
      deleteConversationAction={deleteConversationAction}
      embeddingStorageStatus={snapshot.embeddingStorageStatus}
      initialConversations={snapshot.conversations}
      initialEvalRuns={snapshot.evalRuns}
      importLegacyConversationsAction={importLegacyConversationsAction}
      loadConversationAction={loadConversationAction}
      promoteCorpusAction={promoteCorpusVersionAction}
    />
  );
}
