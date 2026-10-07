"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ShellPanel, useShell } from "@/components/shell/shell-context";
import { WorkspaceLoadError } from "@/components/shell/workspace-load-error";
import type { ApprovalBinding } from "@/lib/agent/policy";
import { assumedPrincipalFor, loadAssumedPrincipalKey } from "@/lib/chat/assumed-principal";
import type { FeedbackValue } from "@/lib/contracts/chat";
import type { EvidenceTab, ReaderDocumentView, SuggestionView } from "@/lib/contracts/chat-view";
import type { DocumentResponse } from "@/lib/contracts/library";
import { useMediaQuery } from "@/lib/use-media-query";
import type { ActionResult } from "@/lib/rag/app-errors";
import { deriveConversationTitle } from "@/lib/rag/chat-history";
import { REAL_STACK_FINGERPRINT } from "@/lib/retrieve/fingerprint";

import { UserBubble, ViewAsBanner } from "./answer";
import {
  citedPassages,
  documentIdForCitation,
  paragraphViews,
  readerFromDocument,
  retrievedPassages,
} from "./answer-view";
import { ChatWorkspace } from "./chat-workspace";
import { AssistantTurn } from "./conversation-turn";
import { CitationLinkProvider, DocumentReader, EvidencePanel } from "./evidence";
import { applyEvidenceUrl, parseEvidenceUrl } from "./evidence-url";
import { messageIdOf, type ChatTurnState } from "./turn-model";
import {
  useChatTurn,
  type AskAction,
  type CancelAction,
  type LoadConversationAction,
} from "./use-chat-turn";

/** The server actions the chat page calls besides asking and stopping. */
export type ChatActions = {
  setFeedback: (messageId: string, value: FeedbackValue | null) => Promise<ActionResult<null>>;
  requestDocument: (messageId: string) => Promise<ActionResult<null>>;
  loadDocument: (input: {
    documentId: string;
    messageId?: string;
    citation?: string;
  }) => Promise<ActionResult<DocumentResponse>>;
  loadConversation: LoadConversationAction;
  startApproval: (
    runId: string,
  ) => Promise<ActionResult<{ workflowId: string; binding: ApprovalBinding }>>;
  decideApproval: (input: {
    workflowId: string;
    decision: "approve" | "reject";
    binding: ApprovalBinding;
  }) => Promise<ActionResult<null>>;
};

export type ChatViewProps = {
  askAction: AskAction;
  cancelAction?: CancelAction;
  actions?: Partial<ChatActions>;
  initialConversation?: { id: string; title: string; turns: ChatTurnState[] } | null;
  loadError?: string | null;
  scopeDocumentId?: string | null;
  suggestions?: SuggestionView[];
};

/** How long Approve and run waits for the run to finish: 15 checks, one second apart. */
export const APPROVAL_POLL_MS = 1000;
export const APPROVAL_POLL_TRIES = 15;

const RERANK_FLOOR = REAL_STACK_FINGERPRINT.relevanceFloor;

/**
 * The chat for `/chat` and `/chat/[id]`. After the first answer the URL moves
 * to the conversation with history.replaceState, which Next folds into
 * usePathname without remounting, so the answer never flashes.
 */
export function ChatSession(props: ChatViewProps) {
  const { newChatNonce, newChat } = useShell();
  const searchParams = useSearchParams();
  // /chat?viewAs=<principalId> comes from the People page. Exit remembers which
  // id was dismissed so the same URL does not bring it back.
  const viewAsParam = searchParams?.get("viewAs") || null;
  const [dismissedViewAs, setDismissedViewAs] = useState<string | null>(null);
  const viewAsId = viewAsParam !== dismissedViewAs ? viewAsParam : null;

  // A saved conversation keeps its own instance. A blank chat starts over
  // whenever New chat is chosen, even when the URL does not change.
  const key = `${props.initialConversation ? props.initialConversation.id : `new:${newChatNonce}`}:${viewAsId ?? ""}`;
  return (
    <ChatView
      key={key}
      {...props}
      onExitViewAs={() => {
        setDismissedViewAs(viewAsParam);
        window.history.replaceState(null, "", window.location.pathname);
        newChat();
      }}
      viewAsId={viewAsId}
    />
  );
}

type PanelState = { open: boolean; tab: EvidenceTab; turnId: string | null };

type ReaderState = {
  documentId: string;
  /** Citation the reader opened for. Null when opened from search. */
  n: number | null;
  turnId: string | null;
  title: string;
  status: "loading" | "ready" | "missing" | "failed";
  view: ReaderDocumentView | null;
  activeN: number | null;
};

function loadingReader(
  documentId: string,
  n: number | null,
  turnId: string | null,
  title: string,
): ReaderState {
  return { documentId, n, turnId, title, status: "loading", view: null, activeN: n };
}

const EMPTY_READER: ReaderDocumentView = {
  title: "",
  version: "",
  effective: "",
  readableBy: { label: "", everyone: false },
  owner: "",
  sections: [],
};

function hasEvidence(turn: ChatTurnState): boolean {
  return (
    turn.answer !== null &&
    turn.answer.structuredAnswer.answerType === "grounded" &&
    turn.answer.retrieval.results.length > 0
  );
}

function plainText(turn: ChatTurnState): string {
  if (!turn.answer) return "";
  return paragraphViews(turn.answer)
    .map((paragraph) => paragraph.text.replace(/\s*\[\d+\]/g, ""))
    .join("\n\n");
}

function ChatView({
  askAction,
  cancelAction,
  actions = {},
  initialConversation = null,
  loadError = null,
  scopeDocumentId = null,
  suggestions = [],
  viewAsId,
  onExitViewAs,
}: ChatViewProps & { viewAsId: string | null; onExitViewAs: () => void }) {
  const router = useRouter();
  const shell = useShell();
  const searchParams = useSearchParams();
  const mobile = useMediaQuery("(max-width: 767px)");
  const isAdmin = shell.identity?.isAdmin === true;
  const readable = shell.identity?.readableDocumentCount ?? 0;

  const chat = useChatTurn({
    askAction,
    cancelAction,
    loadConversation: actions.loadConversation,
    initialTurns: initialConversation?.turns ?? [],
    initialConversationId: initialConversation?.id ?? null,
    scopeDocumentId,
    readableDocuments: readable,
    assumePrincipalId: viewAsId,
    getAssumedPrincipal: () => (viewAsId ? null : assumedPrincipalFor(loadAssumedPrincipalKey())),
    onConversationChange: (id, turns) =>
      shell.upsertConversation(id, deriveConversationTitle(turns[0]?.question ?? "")),
    onNavigate: (id) => window.history.replaceState(null, "", `/chat/${id}`),
  });
  const { turns, patchTurn } = chat;

  // --- evidence panel ------------------------------------------------------
  const [initialUrl] = useState(() => parseEvidenceUrl(searchParams ?? new URLSearchParams()));
  const [panel, setPanel] = useState<PanelState>(() => ({
    open: initialUrl.evidence !== null || initialUrl.doc !== null,
    tab: initialUrl.evidence ?? "cited",
    turnId: null,
  }));
  const [reader, setReader] = useState<ReaderState | null>(() =>
    initialUrl.doc ? loadingReader(initialUrl.doc, initialUrl.c, null, "") : null,
  );
  const readerSeq = useRef(0);

  const evidenceTurns = useMemo(() => turns.filter(hasEvidence), [turns]);
  const panelTurn =
    evidenceTurns.find((turn) => turn.id === panel.turnId) ?? evidenceTurns[evidenceTurns.length - 1] ?? null;
  const panelAnswer = panelTurn?.answer ?? null;
  const cited = useMemo(
    () => (panelAnswer ? citedPassages(panelAnswer, { isAdmin }) : []),
    [panelAnswer, isAdmin],
  );
  const retrieved = useMemo(
    () => (panelAnswer ? retrievedPassages(panelAnswer, { isAdmin }) : []),
    [panelAnswer, isAdmin],
  );

  const fetchReader = useCallback(
    async (seq: number, documentId: string, n: number | null, turn: ChatTurnState | null) => {
      const messageId = turn ? messageIdOf(turn) : null;
      const load = actions.loadDocument;
      const failed: ActionResult<DocumentResponse> = {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "The document could not be loaded.", retryable: true },
      };
      let result: ActionResult<DocumentResponse>;
      try {
        result = await (load
          ? load({
              documentId,
              ...(messageId && n !== null ? { messageId, citation: `[${n}]` } : {}),
            })
          : Promise.resolve(failed));
      } catch {
        result = failed;
      }
      if (seq !== readerSeq.current) return;
      if (!result.ok) {
        const status = result.error.code === "NOT_FOUND" ? "missing" : "failed";
        setReader((current) => (current ? { ...current, status } : current));
        return;
      }
      const { view, activeN } = readerFromDocument(result.data);
      setReader((current) =>
        current ? { ...current, status: "ready", view, title: view.title, activeN: activeN ?? current.n } : current,
      );
    },
    [actions.loadDocument],
  );

  const openDocument = useCallback(
    (documentId: string, n: number | null, turn: ChatTurnState | null, title: string) => {
      readerSeq.current += 1;
      setReader(loadingReader(documentId, n, turn?.id ?? null, title));
      void fetchReader(readerSeq.current, documentId, n, turn);
    },
    [fetchReader],
  );

  // Deep links: ?evidence=...&doc=<id>&c=<n> and ?doc=<id> from search. The
  // reader starts in its loading state; this only fetches the document.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !initialUrl.doc) return;
    deepLinked.current = true;
    readerSeq.current += 1;
    void fetchReader(
      readerSeq.current,
      initialUrl.doc,
      initialUrl.c,
      initialUrl.c !== null ? panelTurn : null,
    );
  }, [fetchReader, initialUrl, panelTurn]);

  // The panel state lives in the URL without navigating.
  useEffect(() => {
    const next = applyEvidenceUrl(window.location.search, {
      evidence: panel.open ? panel.tab : null,
      doc: panel.open && reader ? reader.documentId : null,
      c: panel.open && reader?.n ? reader.n : null,
    });
    const target = `${window.location.pathname}${next ? `?${next}` : ""}`;
    if (target !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", target);
    }
  }, [panel.open, panel.tab, reader]);

  // A new answer takes over an open panel.
  const lastEvidenceId = evidenceTurns[evidenceTurns.length - 1]?.id ?? null;
  const seenEvidenceId = useRef(lastEvidenceId);
  useEffect(() => {
    if (lastEvidenceId === seenEvidenceId.current) return;
    seenEvidenceId.current = lastEvidenceId;
    setPanel((current) => (current.open ? { ...current, turnId: lastEvidenceId } : current));
    setReader(null);
  }, [lastEvidenceId]);

  function closePanel() {
    setPanel((current) => ({ ...current, open: false }));
    setReader(null);
  }

  function openEvidenceFor(turnId: string) {
    setPanel((current) =>
      current.open && current.turnId === turnId ? current : { open: true, tab: "cited", turnId },
    );
    if (turnId !== panelTurn?.id) setReader(null);
  }

  function togglePanel() {
    if (panel.open) {
      closePanel();
    } else {
      setPanel({ open: true, tab: "cited", turnId: evidenceTurns[evidenceTurns.length - 1]?.id ?? null });
    }
  }

  // --- per-turn actions ----------------------------------------------------
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const setActionError = useCallback((turnId: string, message: string | null) => {
    setActionErrors((current) => {
      const next = { ...current };
      if (message) next[turnId] = message;
      else delete next[turnId];
      return next;
    });
  }, []);

  async function copy(turn: ChatTurnState) {
    try {
      await navigator.clipboard.writeText(plainText(turn));
      setActionError(turn.id, null);
    } catch {
      setActionError(turn.id, "The answer could not be copied.");
    }
  }

  async function sendFeedback(turn: ChatTurnState, value: FeedbackValue | null) {
    const id = messageIdOf(turn);
    if (!id || !actions.setFeedback) return;
    const previous = turn.feedback ?? null;
    patchTurn(turn.id, { feedback: value });
    const result = await actions.setFeedback(id, value).catch(() => null);
    if (!result || !result.ok) {
      patchTurn(turn.id, { feedback: previous });
      setActionError(turn.id, "Your feedback could not be saved.");
    } else {
      setActionError(turn.id, null);
    }
  }

  async function requestDocument(turn: ChatTurnState) {
    const id = messageIdOf(turn);
    if (!id || !actions.requestDocument) return;
    const result = await actions.requestDocument(id).catch(() => null);
    if (!result || !result.ok) {
      setActionError(turn.id, "The request could not be sent.");
      return;
    }
    patchTurn(turn.id, { documentRequested: true });
    setActionError(turn.id, null);
  }

  // --- approvals -----------------------------------------------------------
  const [busyApprovals, setBusyApprovals] = useState<Set<string>>(new Set());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [now, setNow] = useState(() => Date.now());
  const hasPendingApproval = turns.some((turn) => turn.approval?.state === "pending");
  useEffect(() => {
    if (!hasPendingApproval) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [hasPendingApproval]);

  async function decide(turn: ChatTurnState, decision: "approve" | "reject") {
    const approval = turn.approval;
    const assistantId = messageIdOf(turn);
    if (!approval || !assistantId || !actions.startApproval || !actions.decideApproval) return;
    setBusyApprovals((current) => new Set(current).add(turn.id));
    setActionError(turn.id, null);
    const finish = () => {
      if (mounted.current) {
        setBusyApprovals((current) => {
          const next = new Set(current);
          next.delete(turn.id);
          return next;
        });
      }
    };
    try {
      const started = await actions.startApproval(approval.runId);
      if (!started.ok) {
        setActionError(turn.id, "The approval could not be started.");
        return;
      }
      const decided = await actions.decideApproval({
        workflowId: started.data.workflowId,
        decision,
        binding: started.data.binding,
      });
      if (!decided.ok) {
        setActionError(turn.id, "The decision could not be recorded.");
        return;
      }
      for (let attempt = 0; attempt < APPROVAL_POLL_TRIES; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, APPROVAL_POLL_MS));
        if (!mounted.current) return;
        const conversationId = chat.conversationId;
        const loaded = conversationId && actions.loadConversation
          ? await actions.loadConversation(conversationId).catch(() => null)
          : null;
        const stored = loaded?.ok ? loaded.data.turns.find((candidate) => candidate.id === assistantId) : undefined;
        if (stored?.approval && stored.approval.state !== "pending") {
          patchTurn(turn.id, { approval: stored.approval });
          return;
        }
      }
      setActionError(turn.id, "The approval is still processing. Reload in a moment to see the result.");
    } catch {
      setActionError(turn.id, "The decision could not be recorded.");
    } finally {
      finish();
    }
  }

  // --- view as -------------------------------------------------------------
  const echo = [...turns].reverse().find((turn) => turn.assumedPerson)?.assumedPerson;

  const title = turns[0]
    ? (shell.conversations.find((conversation) => conversation.id === chat.conversationId)?.title ??
      deriveConversationTitle(turns[0].question))
    : "New chat";
  const placeholder = echo
    ? `Ask as ${echo.displayName}`
    : turns.length > 0 || chat.pendingQuestion
      ? "Ask a follow-up"
      : "Ask a question";

  if (loadError) {
    return <WorkspaceLoadError message={loadError} />;
  }

  const visibleTurns = turns.filter(
    (turn) => !(chat.pendingQuestion && turn.id === chat.retryingTurnId),
  );

  const readerBody: ReaderDocumentView = reader?.view ?? { ...EMPTY_READER, title: reader?.title ?? "" };

  return (
    <CitationLinkProvider>
      <ChatWorkspace
        banner={
          echo ? (
            <ViewAsBanner
              department={echo.department ?? "No department"}
              documentCount={echo.readableDocuments}
              name={echo.displayName}
              onExit={onExitViewAs}
            />
          ) : null
        }
        hasTurns={visibleTurns.length > 0}
        onOpenKnowledge={() => router.push("/admin/sources")}
        onStop={cancelAction ? () => void chat.stop() : undefined}
        onSubmit={(value) => void chat.submit(value)}
        panelToggle={evidenceTurns.length > 0 ? { open: panel.open, onToggle: togglePanel } : undefined}
        pendingQuestion={chat.pendingQuestion}
        placeholder={placeholder}
        progress={chat.progress}
        ready={shell.retrievalReady}
        stopError={chat.stopError}
        stopping={chat.isStopping}
        suggestions={suggestions}
        title={title}
      >
        {visibleTurns.map((turn) => (
          <div
            className="flex flex-col gap-4"
            key={turn.id}
            onClickCapture={hasEvidence(turn) ? () => openEvidenceFor(turn.id) : undefined}
          >
            <UserBubble>{turn.question}</UserBubble>
            <div className={turn.id.startsWith("turn_") && turn.answer ? "rise" : undefined}>
              <AssistantTurn
                actionError={actionErrors[turn.id] ?? null}
                approvalBusy={busyApprovals.has(turn.id)}
                documentsSearched={turn.assumedPerson?.readableDocuments ?? readable}
                mobile={mobile}
                now={now}
                onApprove={() => void decide(turn, "approve")}
                onCopy={() => void copy(turn)}
                onDeny={() => void decide(turn, "reject")}
                onFeedback={(value) => void sendFeedback(turn, value)}
                onOpenEvidence={() => openEvidenceFor(turn.id)}
                onRequestDocument={() => void requestDocument(turn)}
                onRetry={() => void chat.retryTurn(turn.id)}
                stored={messageIdOf(turn) !== null}
                turn={turn}
              />
            </div>
          </div>
        ))}
      </ChatWorkspace>

      <ShellPanel label="Evidence" onClose={closePanel} open={panel.open}>
        {reader ? (
          <DocumentReader
            activeN={reader.activeN}
            doc={readerBody}
            loading={reader.status === "loading"}
            onBack={panelTurn ? () => setReader(null) : undefined}
            onClose={closePanel}
            onOpenInLibrary={() => router.push("/library")}
            unavailable={
              reader.status === "missing"
                ? "This document isn't available"
                : reader.status === "failed"
                  ? "The document could not be loaded"
                  : undefined
            }
          />
        ) : (
          <EvidencePanel
            cited={cited}
            generation={panelAnswer?.corpusGenerationId ?? undefined}
            isAdmin={isAdmin}
            onClose={closePanel}
            onOpenDocument={(n) => {
              if (!panelAnswer || !panelTurn) return;
              const documentId = documentIdForCitation(panelAnswer, n);
              if (!documentId) return;
              void openDocument(
                documentId,
                n,
                panelTurn,
                cited.find((passage) => passage.n === n)?.document ?? "",
              );
            }}
            onTabChange={(tab) => setPanel((current) => ({ ...current, tab }))}
            rerankFloor={RERANK_FLOOR}
            retrieved={retrieved}
            tab={panel.tab}
          />
        )}
      </ShellPanel>
    </CitationLinkProvider>
  );
}
