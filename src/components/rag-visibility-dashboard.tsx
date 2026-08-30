"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import type { WorkspaceIdentity } from "@/app/actions";
import type { DocumentChunk, KnowledgeDocument } from "@/lib/rag/types";
import type { GroundedAnswerResponse } from "@/lib/rag/grounded-answer";
import type { EmbeddingStorageStatus } from "@/lib/rag/storage-records";
import type { ActionResult } from "@/lib/rag/app-errors";
import { runEvalsAction } from "@/app/eval-actions";
import { EvaluationsWorkspace } from "@/components/evaluations/evaluations-workspace";
import { KnowledgeWorkspace } from "@/components/knowledge/knowledge-workspace";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";
import {
  buildEvidenceItems as buildChatEvidenceItems,
  ChatWorkspace,
  filterCitedEvidence as filterChatCitedEvidence,
} from "@/components/chat/chat-workspace";
import {
  EvidenceChunkDialog,
  EvidenceInspector,
  type EvidenceItem,
} from "@/components/chat/evidence-inspector";
import {
  WorkspaceShell,
  type WorkspaceView,
} from "@/components/workspace/workspace-shell";
import { WorkspaceNav } from "@/components/workspace/workspace-nav";
import {
  createId,
  deriveConversationTitle,
  loadLegacyConversationsForMigration,
  markLegacyConversationMigrationComplete,
  MAX_CONVERSATIONS,
  type ChatTurn,
  type Conversation,
} from "@/lib/rag/chat-history";
import type { EvalRunResult } from "@/lib/eval/manual-eval-set";
import { NORTHWIND_PRINCIPALS } from "@/lib/eval/northwind-principals";
import { isRetrievalReady } from "@/lib/rag/workspace-status";
import type { KnowledgeInventory } from "@/lib/store/knowledge-inventory";

const ASSUMED_PRINCIPAL_STORAGE_KEY = "useful-brain.assumed-principal";
const ASSUMED_PRINCIPAL_EVENT = "useful-brain:assumed-principal";

function loadStoredAssumedPrincipal(): string | null {
  try {
    const stored = window.localStorage.getItem(ASSUMED_PRINCIPAL_STORAGE_KEY);
    return stored && NORTHWIND_PRINCIPALS.some((principal) => principal.key === stored)
      ? stored
      : null;
  } catch {
    return null;
  }
}

function subscribeToAssumedPrincipal(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(ASSUMED_PRINCIPAL_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(ASSUMED_PRINCIPAL_EVENT, callback);
  };
}

type AskAction = (input: {
  question: string;
  conversationId: string | null;
  requestId: string;
  assumePrincipal?: { userId: string; roles: string[]; departments: string[] } | null;
}) => Promise<ActionResult<GroundedAnswerResponse>>;

type CancelAction = (
  requestId: string,
) => Promise<ActionResult<{ conversationId: string }>>;

type RagVisibilityDashboardProps = {
  documents: KnowledgeDocument[];
  chunks: DocumentChunk[];
  addDocumentAction: (formData: FormData) => Promise<void>;
  embedAction: () => Promise<void>;
  askAction: AskAction;
  cancelAction?: CancelAction;
  embeddingStorageStatus: EmbeddingStorageStatus;
  initialConversations?: Conversation[];
  initialEvalRuns?: EvalRunResult[];
  deleteConversationAction?: (
    conversationId: string,
  ) => Promise<ActionResult<null>>;
  deleteDocumentAction?: (documentId: string) => Promise<ActionResult<null>>;
  promoteCorpusAction?: (versionId: string) => Promise<void>;
  importLegacyConversationsAction?: (
    conversations: Conversation[],
  ) => Promise<ActionResult<null>>;
  identity?: WorkspaceIdentity | null;
  initialAddDocument?: boolean;
  initialConversation?: Conversation | null;
  initialView?: WorkspaceView;
  reindexAction?: () => Promise<void>;
  retrievalMode?: KnowledgeInventory["retrievalMode"];
  workspaceError?: string | null;
};

export function RagVisibilityDashboard({
  documents,
  chunks,
  addDocumentAction,
  embedAction,
  askAction,
  cancelAction,
  embeddingStorageStatus,
  initialConversations = [],
  initialEvalRuns = [],
  deleteConversationAction,
  deleteDocumentAction,
  promoteCorpusAction,
  importLegacyConversationsAction,
  identity = null,
  initialAddDocument = false,
  initialConversation = null,
  initialView = "chat",
  reindexAction,
  retrievalMode = "keyword",
  workspaceError = null,
}: RagVisibilityDashboardProps) {
  const router = useRouter();
  const [activeView, setActiveView] = useState<WorkspaceView>(initialView);
  const assumedPrincipalKey = useSyncExternalStore(
    subscribeToAssumedPrincipal,
    loadStoredAssumedPrincipal,
    () => null,
  );
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [selectedChunk, setSelectedChunk] = useState<EvidenceItem | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusText, setFocusText] = useState<string | null>(null);

  // Conversation state lives here so the sources panel (a sibling of the chat)
  // can read the active turn's evidence.
  const [turns, setTurns] = useState<ChatTurn[]>(initialConversation?.turns ?? []);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>(
    initialConversations,
  );
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(initialConversation?.id ?? null);
  // Bumped on New chat / switching chats so an in-flight answer from an
  // abandoned conversation is dropped instead of landing in the current one.
  const conversationRef = useRef(0);
  const turnSeq = useRef(0);
  const stoppedConversationRouteRef = useRef<string | null>(null);

  useEffect(() => {
    if (!importLegacyConversationsAction) return;
    const legacy = loadLegacyConversationsForMigration();
    if (legacy.length === 0) {
      markLegacyConversationMigrationComplete();
      return;
    }
    void importLegacyConversationsAction(legacy).then((result) => {
      if (!result.ok) return;
      markLegacyConversationMigrationComplete();
      window.location.reload();
    });
  }, [importLegacyConversationsAction]);

  function assumePrincipal(key: string | null) {
    try {
      if (key) {
        window.localStorage.setItem(ASSUMED_PRINCIPAL_STORAGE_KEY, key);
      } else {
        window.localStorage.removeItem(ASSUMED_PRINCIPAL_STORAGE_KEY);
      }
    } catch {
      // Without storage the selection cannot apply; the select re-reads it.
    }
    window.dispatchEvent(new Event(ASSUMED_PRINCIPAL_EVENT));
  }

  const retrievalReady = isRetrievalReady(embeddingStorageStatus);

  const activeAnswer = useMemo(
    () => turns.find((turn) => turn.id === activeTurnId)?.answer ?? null,
    [turns, activeTurnId],
  );
  const retrievedItems = useMemo(
    () => buildChatEvidenceItems(activeAnswer),
    [activeAnswer],
  );
  const citedItems = useMemo(
    () => filterChatCitedEvidence(activeAnswer, retrievedItems),
    [activeAnswer, retrievedItems],
  );

  function upsertConversationSummary(id: string, nextTurns: ChatTurn[]) {
    const title = deriveConversationTitle(nextTurns[0]?.question ?? "");
    setConversations((current) => {
      const existing = current.find((conversation) => conversation.id === id);
      const updated: Conversation = {
        id,
        title,
        turns: nextTurns,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      const next = [
        updated,
        ...current.filter((conversation) => conversation.id !== id),
      ].slice(0, MAX_CONVERSATIONS);
      return next;
    });
  }

  async function submitQuestion(rawValue: string) {
    const question = rawValue.trim();
    if (!question || pendingQuestion) {
      return;
    }

    const guardToken = conversationRef.current;
    const priorTurns = turns;
    const requestId = createId();

    stoppedConversationRouteRef.current = null;
    setStopError(null);
    setPendingQuestion(question);
    setPendingRequestId(requestId);
    const assumed = NORTHWIND_PRINCIPALS.find(
      (candidate) => candidate.key === assumedPrincipalKey,
    );
    try {
      const result = await askAction({
        question,
        conversationId: activeConversationId,
        requestId,
        assumePrincipal: assumed
          ? {
              userId: assumed.userId,
              roles: assumed.roles,
              departments: assumed.departments,
            }
          : null,
      });
      if (conversationRef.current !== guardToken) {
        finishStoppedConversationRoute();
        return;
      }
      turnSeq.current += 1;

      if (!result.ok) {
        const cancelled = result.error.code === "CANCELLED";
        const nextTurns = [
          ...priorTurns,
          {
            id: `turn_${turnSeq.current}`,
            question,
            answer: null,
            error: cancelled ? null : result.error.message,
            errorRetryable: result.error.retryable,
            cancelled,
          },
        ];
        setTurns(nextTurns);
        return;
      }

      const answer = result.data;
      const nextTurns = [
        ...priorTurns,
        { id: `turn_${turnSeq.current}`, question, answer, error: null },
      ];
      setTurns(nextTurns);
      const backendConversationId =
        answer.conversationId ?? activeConversationId;
      if (backendConversationId) {
        setActiveConversationId(backendConversationId);
        upsertConversationSummary(backendConversationId, nextTurns);
        router.replace(`/chat/${backendConversationId}`);
      }
    } catch {
      if (conversationRef.current !== guardToken) {
        finishStoppedConversationRoute();
        return;
      }
      turnSeq.current += 1;
      const nextTurns = [
        ...priorTurns,
        {
          id: `turn_${turnSeq.current}`,
          question,
          answer: null,
          error: "Could not generate an answer.",
        },
      ];
      setTurns(nextTurns);
    } finally {
      if (conversationRef.current === guardToken) {
        setPendingQuestion(null);
        setPendingRequestId(null);
      }
    }
  }

  async function stopQuestion() {
    if (!cancelAction || !pendingRequestId || !pendingQuestion || isStopping) {
      return;
    }
    setStopError(null);
    setIsStopping(true);
    const question = pendingQuestion;
    let result: Awaited<ReturnType<CancelAction>>;
    try {
      result = await cancelAction(pendingRequestId);
    } catch {
      setStopError("The answer could not be stopped.");
      setIsStopping(false);
      return;
    }
    if (!result.ok) {
      setStopError(result.error.message);
      setIsStopping(false);
      return;
    }
    conversationRef.current += 1;
    turnSeq.current += 1;
    const nextTurns = [
      ...turns,
      {
        id: `turn_${turnSeq.current}`,
        question,
        answer: null,
        error: null,
        cancelled: true,
      },
    ];
    setTurns(nextTurns);
    setPendingQuestion(null);
    setPendingRequestId(null);
    setIsStopping(false);
    setActiveConversationId(result.data.conversationId);
    upsertConversationSummary(result.data.conversationId, nextTurns);
    stoppedConversationRouteRef.current = result.data.conversationId;
  }

  function finishStoppedConversationRoute() {
    const conversationId = stoppedConversationRouteRef.current;
    if (!conversationId) return;
    stoppedConversationRouteRef.current = null;
    router.replace(`/chat/${conversationId}`);
  }

  function startNewChat() {
    conversationRef.current += 1;
    stoppedConversationRouteRef.current = null;
    setTurns([]);
    setPendingQuestion(null);
    setPendingRequestId(null);
    setStopError(null);
    setIsStopping(false);
    setActiveTurnId(null);
    setActiveConversationId(null);
    setSourcesOpen(false);
    setFocusId(null);
    setFocusText(null);
    setSelectedChunk(null);
    router.push("/chat");
  }

  function selectConversation(id: string) {
    stoppedConversationRouteRef.current = null;
    router.push(`/chat/${id}`);
  }

  async function deleteConversation(id: string) {
    setConversationError(null);
    if (deleteConversationAction) {
      const result = await deleteConversationAction(id);
      if (!result.ok) {
        setConversationError(result.error.message);
        return;
      }
    }
    setConversations((current) => {
      return current.filter((conversation) => conversation.id !== id);
    });
    if (id === activeConversationId) {
      conversationRef.current += 1;
      setTurns([]);
      setActiveConversationId(null);
      setPendingQuestion(null);
      setPendingRequestId(null);
      setStopError(null);
      setIsStopping(false);
      setActiveTurnId(null);
      setSourcesOpen(false);
      setFocusId(null);
      setFocusText(null);
      router.push("/chat");
    }
    router.refresh();
  }

  function openSources(turnId: string) {
    if (turnId !== activeTurnId) {
      setFocusId(null);
      setFocusText(null);
    }
    setActiveTurnId(turnId);
    setSourcesOpen(true);
  }

  function focusEvidence(
    turnId: string,
    id: string,
    matchedSentence: string,
  ) {
    setActiveTurnId(turnId);
    setSourcesOpen(true);
    setFocusId(id);
    setFocusText(matchedSentence);
    setFocusToken((token) => token + 1);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      // A dialog owns Escape while it is open; let it close only itself so the
      // sources panel behind it does not collapse at the same time.
      if (selectedChunk) {
        return;
      }
      setSourcesOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedChunk]);

  function selectWorkspaceView(view: WorkspaceView) {
    stoppedConversationRouteRef.current = null;
    setActiveView(view);
    setSourcesOpen(false);
    const href = {
      chat: "/chat",
      knowledge: "/knowledge",
      evaluations: "/evaluations",
      settings: "/settings",
    }[view];
    router.push(href);
  }

  return (
    <WorkspaceShell
      activeView={activeView}
      inspector={
        activeView === "chat" && sourcesOpen ? (
          <>
            <button
              aria-label="Close sources"
              className="fixed inset-0 z-30 bg-ink/30 lg:hidden"
              onClick={() => setSourcesOpen(false)}
              type="button"
            />
            <EvidenceInspector
              citedItems={citedItems}
              focusId={focusId}
              focusText={focusText}
              focusToken={focusToken}
              onClose={() => setSourcesOpen(false)}
              onOpenChunk={setSelectedChunk}
              retrievedItems={retrievedItems}
            />
          </>
        ) : undefined
      }
      navigation={
        <WorkspaceNav
          activeConversationId={activeConversationId}
          activeView={activeView}
          conversations={conversations}
          conversationError={conversationError}
          documentsCount={documents.length}
          embeddedChunks={embeddingStorageStatus.embeddedChunks}
          onDeleteConversation={deleteConversation}
          onNewChat={startNewChat}
          onSelectConversation={selectConversation}
          onSelectView={selectWorkspaceView}
          retrievalReady={retrievalReady}
        />
      }
      onSelectView={selectWorkspaceView}
    >
      {workspaceError ? (
        <WorkspaceLoadError message={workspaceError} />
      ) : activeView === "chat" ? (
        <ChatWorkspace
          askDisabled={!retrievalReady}
          canReset={turns.length > 0 || pendingQuestion !== null}
          focusedEvidenceId={focusId}
          onFocusEvidence={focusEvidence}
          onNewChat={startNewChat}
          onOpenKnowledge={() => selectWorkspaceView("knowledge")}
          onOpenSources={openSources}
          onStop={cancelAction ? stopQuestion : undefined}
          onSubmit={submitQuestion}
          pendingQuestion={pendingQuestion}
          ready={retrievalReady}
          stopError={stopError}
          stopping={isStopping}
          turns={turns}
        />
      ) : (
        <ScrollView>
          {activeView === "knowledge" ? (
            <KnowledgeWorkspace
              addDocumentAction={addDocumentAction}
              chunks={chunks}
              deleteDocumentAction={deleteDocumentAction}
              documents={documents}
              embedAction={embedAction}
              embeddingStorageStatus={embeddingStorageStatus}
              initialAddOpen={initialAddDocument}
              promoteAction={promoteCorpusAction}
              reindexAction={reindexAction}
              retrievalMode={retrievalMode}
            />
          ) : null}
          {activeView === "evaluations" ? (
            <EvaluationsWorkspace
              history={initialEvalRuns.slice(1)}
              initialRun={initialEvalRuns[0] ?? null}
              runAction={runEvalsAction}
              runLabel="Run evaluations"
            />
          ) : null}
          {activeView === "settings" ? (
            <SettingsWorkspace
              assumedPrincipalKey={assumedPrincipalKey}
              identity={identity}
              onAssumePrincipal={assumePrincipal}
              retrievalMode={retrievalMode}
              status={embeddingStorageStatus}
            />
          ) : null}
        </ScrollView>
      )}

      {selectedChunk ? (
        <EvidenceChunkDialog
          focusText={focusText}
          item={selectedChunk}
          onClose={() => setSelectedChunk(null)}
        />
      ) : null}
    </WorkspaceShell>
  );
}

function WorkspaceLoadError({ message }: { message: string }) {
  return (
    <div className="grid h-full place-items-center px-5">
      <div className="empty-state max-w-md" role="alert">
        <h1 className="text-lg font-semibold text-ink">Workspace unavailable</h1>
        <p>{message}</p>
        <button
          className="btn btn-primary min-h-10 px-4 text-sm"
          onClick={() => window.location.reload()}
          type="button"
        >
          Reload workspace
        </button>
      </div>
    </div>
  );
}

function ScrollView({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="panel-in mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
        {children}
      </div>
    </div>
  );
}
