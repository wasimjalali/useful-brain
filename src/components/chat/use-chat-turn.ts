"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  isTurnProgressCount,
  normalizeTurnStage,
} from "@/lib/cf/turn-progress";
import type { ChatProgressView } from "@/lib/contracts/chat-view";
import type { ConversationView } from "@/lib/contracts/chat";
import type { ActionResult } from "@/lib/rag/app-errors";
import { createId } from "@/lib/rag/chat-history";
import type { GroundedAnswerResponse } from "@/lib/rag/grounded-answer";

import { messageIdOf, type ChatTurnState } from "./turn-model";

export type AssumedPrincipal = {
  userId: string;
  roles: string[];
  departments: string[];
};

export type AskAction = (input: {
  question: string;
  conversationId: string | null;
  requestId: string;
  assumePrincipal?: AssumedPrincipal | null;
  assumePrincipalId?: string;
  scopeDocumentId?: string;
  retryOfMessageId?: string;
}) => Promise<ActionResult<GroundedAnswerResponse>>;

export type CancelAction = (
  requestId: string,
) => Promise<ActionResult<{ conversationId: string }>>;

export type LoadConversationAction = (
  conversationId: string,
) => Promise<ActionResult<ConversationView>>;

export type UseChatTurnOptions = {
  askAction: AskAction;
  cancelAction?: CancelAction;
  /** Reads stored turns back: failed message ids for Retry, latency and titles after an answer. */
  loadConversation?: LoadConversationAction;
  initialTurns?: ChatTurnState[];
  initialConversationId?: string | null;
  /** Document to scope the first turn to (Library "Ask about this"). */
  scopeDocumentId?: string | null;
  /** The asker's readable document count, shown until Brain reports its own. */
  readableDocuments?: number;
  /** Read at submit time so a View as change applies to the next question. */
  getAssumedPrincipal?: () => AssumedPrincipal | null;
  /** Admin View as: a principals.id. View-as turns are not persisted and have no progress endpoint. */
  assumePrincipalId?: string | null;
  /** Fires when the server confirms a conversation (first answer, stop). */
  onConversationChange?: (conversationId: string, turns: ChatTurnState[]) => void;
  /** Fires when the URL should move to the conversation. */
  onNavigate?: (conversationId: string) => void;
};

const POLL_INTERVAL_MS = 2000;

/** Reads the closed progress union from the poll. Anything else is not progress. */
export function parseProgress(body: unknown): ChatProgressView | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  const stage = normalizeTurnStage(record.stage);
  if (stage === "writing") {
    return isTurnProgressCount(record.passages)
      ? { kind: "writing", passages: record.passages }
      : { kind: "writing" };
  }
  if (stage === "searching" && isTurnProgressCount(record.readableDocuments)) {
    return { kind: "searching", readableDocuments: record.readableDocuments };
  }
  if (stage === "reading" && isTurnProgressCount(record.passages)) {
    return { kind: "reading", passages: record.passages };
  }
  return null;
}

function withMessageIds(turns: ChatTurnState[]): ChatTurnState[] {
  // A stored failed turn is keyed by its assistant message id.
  return turns.map((turn) =>
    turn.answer === null && !turn.messageId ? { ...turn, messageId: turn.id } : turn,
  );
}

/**
 * Stored extras of a just-finished turn (latency, passage count, catalog
 * titles, approval). Local choices made since the answer landed win.
 */
export function mergeStoredTurn(local: ChatTurnState, stored: ChatTurnState): ChatTurnState {
  return {
    ...local,
    latencyMs: stored.latencyMs ?? local.latencyMs ?? null,
    passagesRetrieved: stored.passagesRetrieved ?? local.passagesRetrieved ?? null,
    approval: local.approval ?? stored.approval,
    documentRequested: local.documentRequested || stored.documentRequested || false,
    answer:
      local.answer && stored.answer
        ? {
            ...local.answer,
            retrieval: { ...local.answer.retrieval, results: stored.answer.retrieval.results },
          }
        : local.answer,
  };
}

/**
 * One chat session: submit, retry, stop, 2s progress poll, cancel and the
 * abandoned-conversation guard. The awaited ask action is the only source of
 * a final answer. Progress only moves the status line.
 */
export function useChatTurn({
  askAction,
  cancelAction,
  loadConversation,
  initialTurns = [],
  initialConversationId = null,
  scopeDocumentId = null,
  readableDocuments = 0,
  getAssumedPrincipal,
  assumePrincipalId = null,
  onConversationChange,
  onNavigate,
}: UseChatTurnOptions) {
  const [turns, setTurns] = useState<ChatTurnState[]>(() => withMessageIds(initialTurns));
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  );
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [retryingTurnId, setRetryingTurnId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    requestId: string;
    view: ChatProgressView;
  } | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  // Bumped on reset, on unmount and when the user leaves, so an in-flight
  // answer from an abandoned conversation is dropped instead of landing here.
  const guard = useRef(0);
  const turnSeq = useRef(0);
  const stoppedRouteRef = useRef<string | null>(null);
  const latest = useRef({ onConversationChange, onNavigate, getAssumedPrincipal });
  useEffect(() => {
    latest.current = { onConversationChange, onNavigate, getAssumedPrincipal };
  });

  useEffect(
    () => () => {
      guard.current += 1;
      stoppedRouteRef.current = null;
    },
    [],
  );

  // View-as turns are not stored, so Brain has no progress for them.
  const pollProgress = assumePrincipalId === null;
  useEffect(() => {
    if (!pendingRequestId || !pollProgress) {
      return;
    }
    const requestId = pendingRequestId;
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleNext = () => {
      if (!stopped) {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };
    async function poll() {
      if (stopped || inFlight) {
        // An overlapping tick skips itself and reschedules so one slow
        // response cannot silently end the whole loop.
        scheduleNext();
        return;
      }
      inFlight = true;
      try {
        const response = await fetch(`/api/turns/${encodeURIComponent(requestId)}`, {
          cache: "no-store",
        });
        if (response.ok) {
          const view = parseProgress(await response.json());
          if (!stopped && view) {
            setProgress({ requestId, view });
          }
        }
      } catch {
        // Progress is best-effort; a failed poll leaves the last stage shown.
      } finally {
        inFlight = false;
      }
      scheduleNext();
    }
    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [pendingRequestId, pollProgress]);

  const finishStoppedRoute = useCallback(() => {
    const id = stoppedRouteRef.current;
    if (!id) return;
    stoppedRouteRef.current = null;
    latest.current.onNavigate?.(id);
  }, []);

  const patchTurn = useCallback((turnId: string, patch: Partial<ChatTurnState>) => {
    setTurns((current) =>
      current.map((turn) => (turn.id === turnId ? { ...turn, ...patch } : turn)),
    );
  }, []);

  /** Best effort: stored latency, passage count and catalog titles for a finished turn. */
  const enrich = useCallback(
    async (turnId: string, assistantMessageId: string, backendConversationId: string, guardToken: number) => {
      if (!loadConversation) return;
      let loaded: Awaited<ReturnType<LoadConversationAction>>;
      try {
        loaded = await loadConversation(backendConversationId);
      } catch {
        return;
      }
      if (!loaded.ok || guard.current !== guardToken) return;
      const stored = loaded.data.turns.find((turn) => turn.id === assistantMessageId);
      if (!stored) return;
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId ? mergeStoredTurn(turn, stored as ChatTurnState) : turn,
        ),
      );
    },
    [loadConversation],
  );

  const submit = useCallback(
    async (
      rawValue: string,
      options: { retryOfMessageId?: string; replaceTurnId?: string } = {},
    ) => {
      const question = rawValue.trim();
      if (!question || pendingQuestion) {
        return;
      }
      const guardToken = guard.current;
      const priorTurns = turns;
      const requestId = createId();
      const place = (turn: ChatTurnState): ChatTurnState[] =>
        options.replaceTurnId
          ? priorTurns.map((prior) => (prior.id === options.replaceTurnId ? turn : prior))
          : [...priorTurns, turn];

      stoppedRouteRef.current = null;
      setStopError(null);
      setPendingQuestion(question);
      setPendingRequestId(requestId);
      setRetryingTurnId(options.replaceTurnId ?? null);
      try {
        const result = await askAction({
          question,
          conversationId,
          requestId,
          assumePrincipal: latest.current.getAssumedPrincipal?.() ?? null,
          ...(assumePrincipalId ? { assumePrincipalId } : {}),
          ...(options.retryOfMessageId ? { retryOfMessageId: options.retryOfMessageId } : {}),
          ...(conversationId === null && scopeDocumentId ? { scopeDocumentId } : {}),
        });
        if (guard.current !== guardToken) {
          finishStoppedRoute();
          return;
        }
        turnSeq.current += 1;

        if (!result.ok) {
          const cancelled = result.error.code === "CANCELLED";
          // Brain stored the failed turn (in a conversation it may have just
          // created): keep both ids so Retry and the next question stay in it.
          const storedTurn = result.error.turn;
          setTurns(
            place({
              id: `turn_${turnSeq.current}`,
              question,
              answer: null,
              error: cancelled ? null : result.error.message,
              errorRetryable: result.error.retryable,
              ...(cancelled ? {} : { errorCode: result.error.code }),
              ...(storedTurn ? { messageId: storedTurn.assistantMessageId } : {}),
              cancelled,
            }),
          );
          if (storedTurn && conversationId === null) {
            setConversationId(storedTurn.conversationId);
          }
          return;
        }

        const data = result.data as GroundedAnswerResponse &
          Pick<ChatTurnState, "approval" | "assumedPerson" | "adminDiagnostic">;
        const newTurn: ChatTurnState = {
          id: `turn_${turnSeq.current}`,
          question,
          answer: result.data,
          error: null,
          ...(data.approval ? { approval: data.approval } : {}),
          ...(data.assumedPerson ? { assumedPerson: data.assumedPerson } : {}),
          ...(data.adminDiagnostic ? { adminDiagnostic: data.adminDiagnostic } : {}),
        };
        const nextTurns = place(newTurn);
        setTurns(nextTurns);
        const backendConversationId = result.data.conversationId ?? conversationId;
        if (backendConversationId) {
          setConversationId(backendConversationId);
          latest.current.onConversationChange?.(backendConversationId, nextTurns);
          latest.current.onNavigate?.(backendConversationId);
          if (result.data.assistantMessageId) {
            void enrich(newTurn.id, result.data.assistantMessageId, backendConversationId, guardToken);
          }
        }
      } catch {
        if (guard.current !== guardToken) {
          finishStoppedRoute();
          return;
        }
        turnSeq.current += 1;
        setTurns(
          place({
            id: `turn_${turnSeq.current}`,
            question,
            answer: null,
            error: "Could not generate an answer.",
          }),
        );
      } finally {
        if (guard.current === guardToken) {
          setPendingQuestion(null);
          setPendingRequestId(null);
          setRetryingTurnId(null);
        }
      }
    },
    [
      askAction,
      assumePrincipalId,
      conversationId,
      enrich,
      finishStoppedRoute,
      pendingQuestion,
      scopeDocumentId,
      turns,
    ],
  );

  /**
   * Retry. A failed or stopped turn re-runs its saved question through
   * retryOfMessageId and takes the failed turn's place. An answered turn is
   * asked again as a new turn: Brain only retries failed messages.
   */
  const retryTurn = useCallback(
    async (turnId: string) => {
      const turn = turns.find((candidate) => candidate.id === turnId);
      if (!turn || pendingQuestion) {
        return;
      }
      if (turn.answer) {
        await submit(turn.question);
        return;
      }
      let failedId = messageIdOf(turn);
      if (!failedId && conversationId && loadConversation) {
        try {
          const loaded = await loadConversation(conversationId);
          if (loaded.ok) {
            const failed = [...loaded.data.turns]
              .reverse()
              .find((stored) => stored.answer === null && stored.question === turn.question);
            failedId = failed?.id ?? null;
          }
        } catch {
          failedId = null;
        }
      }
      if (failedId) {
        await submit(turn.question, { retryOfMessageId: failedId, replaceTurnId: turn.id });
      } else {
        // Brain never stored this failure (it came before the turn existed),
        // so there is no message to retry. Ask the saved question again.
        await submit(turn.question, { replaceTurnId: turn.id });
      }
    },
    [conversationId, loadConversation, pendingQuestion, submit, turns],
  );

  const stop = useCallback(async () => {
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
    guard.current += 1;
    turnSeq.current += 1;
    const stoppedTurn: ChatTurnState = {
      id: `turn_${turnSeq.current}`,
      question,
      answer: null,
      error: null,
      cancelled: true,
    };
    const nextTurns = retryingTurnId
      ? turns.map((turn) => (turn.id === retryingTurnId ? stoppedTurn : turn))
      : [...turns, stoppedTurn];
    setTurns(nextTurns);
    setPendingQuestion(null);
    setPendingRequestId(null);
    setRetryingTurnId(null);
    setIsStopping(false);
    setConversationId(result.data.conversationId);
    latest.current.onConversationChange?.(result.data.conversationId, nextTurns);
    stoppedRouteRef.current = result.data.conversationId;
  }, [cancelAction, isStopping, pendingQuestion, pendingRequestId, retryingTurnId, turns]);

  /** New chat: drop the transcript and any in-flight answer. */
  const reset = useCallback(() => {
    guard.current += 1;
    stoppedRouteRef.current = null;
    setTurns([]);
    setConversationId(null);
    setPendingQuestion(null);
    setPendingRequestId(null);
    setRetryingTurnId(null);
    setStopError(null);
    setIsStopping(false);
  }, []);

  const shownProgress: ChatProgressView | null = pendingRequestId
    ? progress?.requestId === pendingRequestId
      ? progress.view
      : { kind: "searching", readableDocuments }
    : null;

  return {
    turns,
    conversationId,
    pendingQuestion,
    retryingTurnId,
    progress: shownProgress,
    isStopping,
    stopError,
    submit,
    retryTurn,
    patchTurn,
    stop,
    reset,
  };
}
