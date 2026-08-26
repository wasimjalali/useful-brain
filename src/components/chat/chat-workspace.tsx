"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowRightIcon, LayersIcon, NewChatIcon } from "@/components/icons";
import { UsefulBrainMark } from "@/components/useful-brain-logo";
import { DEFAULT_USEFUL_BRAIN_CONFIG } from "@/lib/useful-brain-config";
import type { GroundedAnswerResponse } from "@/lib/rag/grounded-answer";
import type { ChatTurn } from "@/lib/rag/chat-history";
import { formatRetrievalScore } from "@/lib/rag/retrieval";

import { ChatComposer } from "./chat-composer";
import { ConversationTurn } from "./conversation-turn";
import type { EvidenceItem } from "./evidence-inspector";

export { type EvidenceItem } from "./evidence-inspector";

const SAMPLE_QUESTIONS = [
  "Can customers return opened products?",
  "Does express shipping change the order cutoff?",
  "How much can an agent discount without manager approval?",
  "How do I pause a subscription for a month?",
];

type ChatWorkspaceProps = {
  askDisabled: boolean;
  canReset: boolean;
  focusedEvidenceId: string | null;
  onFocusEvidence: (
    turnId: string,
    evidenceId: string,
    matchedSentence: string,
  ) => void;
  onNewChat: () => void;
  onOpenSources: (turnId: string) => void;
  onSubmit: (value: string) => void;
  pendingQuestion: string | null;
  ready: boolean;
  turns: ChatTurn[];
};

export function ChatWorkspace({
  askDisabled,
  canReset,
  focusedEvidenceId,
  onFocusEvidence,
  onNewChat,
  onOpenSources,
  onSubmit,
  pendingQuestion,
  ready,
  turns,
}: ChatWorkspaceProps) {
  const [question, setQuestion] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasConversation = turns.length > 0 || pendingQuestion !== null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [turns.length, pendingQuestion]);

  function send(value = question) {
    const nextQuestion = value.trim();
    if (!nextQuestion || askDisabled || pendingQuestion) {
      return;
    }
    onSubmit(nextQuestion);
    setQuestion("");
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2.5 sm:px-6">
        <h1 className="text-sm font-semibold text-ink">Support chat</h1>
        <button
          className="btn btn-secondary min-h-10 px-3 text-sm"
          disabled={!canReset}
          onClick={onNewChat}
          type="button"
        >
          <NewChatIcon className="size-4" />
          New chat
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
          {!ready ? (
            <SetupNotice />
          ) : !hasConversation ? (
            <ChatWelcome onRunQuestion={send} />
          ) : (
            <div className="flex flex-col gap-6">
              {turns.map((turn, index) => {
                const isLast = index === turns.length - 1 && pendingQuestion === null;
                return (
                  <div className="flex flex-col gap-6" key={turn.id}>
                    <UserMessage text={turn.question} />
                    <div aria-live={isLast ? "polite" : undefined}>
                      {turn.error ? (
                        <ErrorMessage
                          message={turn.error}
                          onRetry={
                            turn.errorRetryable
                              ? () => send(turn.question)
                              : undefined
                          }
                        />
                      ) : turn.answer ? (
                        <ConversationTurn
                          activeEvidenceId={focusedEvidenceId}
                          answer={turn.answer}
                          onFocusEvidence={(evidenceId, matchedSentence) =>
                            onFocusEvidence(turn.id, evidenceId, matchedSentence)
                          }
                          onOpenSources={() => onOpenSources(turn.id)}
                          onRetry={send}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {pendingQuestion ? (
                <div className="flex flex-col gap-6">
                  <UserMessage text={pendingQuestion} />
                  <ThinkingIndicator />
                </div>
              ) : null}
              <div aria-hidden="true" ref={bottomRef} />
            </div>
          )}
        </div>
      </div>

      <ChatComposer
        disabled={askDisabled}
        onChange={setQuestion}
        onSend={() => send()}
        pending={pendingQuestion !== null}
        value={question}
      />
    </div>
  );
}

function ChatWelcome({ onRunQuestion }: { onRunQuestion: (value: string) => void }) {
  return (
    <div className="rise flex flex-col items-center pt-8 text-center sm:pt-16">
      <span className="grid size-14 place-items-center rounded-2xl bg-brand shadow-sm">
        <UsefulBrainMark className="size-9" tone="dark" />
      </span>
      <h2 className="mt-5 text-2xl font-semibold tracking-[-0.01em] text-ink">
        Ask a grounded question
      </h2>
      <p className="mt-2 max-w-md text-[15px] leading-6 text-ink-muted">
        {DEFAULT_USEFUL_BRAIN_CONFIG.productName} answers only from retrieved company documents
        and cites every source. If evidence is missing, it says so.
      </p>

      <div className="mt-8 grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {SAMPLE_QUESTIONS.map((sample) => (
          <button
            className="suggestion-button min-h-12 px-4 py-3 text-left text-sm text-ink"
            key={sample}
            onClick={() => onRunQuestion(sample)}
            type="button"
          >
            <span>{sample}</span>
            <ArrowRightIcon className="size-4 shrink-0 text-ink-faint" />
          </button>
        ))}
      </div>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="msg-in flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-6 text-white shadow-sm">
        {text}
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="msg-in flex gap-3" role="status">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand shadow-sm">
        <UsefulBrainMark className="size-5" tone="dark" />
      </span>
      <div className="flex items-center gap-2.5 pt-1.5">
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
        />
        <span className="text-sm text-ink-muted">Looking for relevant support evidence.</span>
      </div>
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="rise rounded-2xl border border-dashed border-border-strong bg-surface p-6 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-xl bg-warning-soft text-warning">
        <LayersIcon className="size-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-ink">
        Store and embed chunks before answer generation.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-muted">
        The corpus has not been embedded yet. Open {DEFAULT_USEFUL_BRAIN_CONFIG.knowledgeLabel}
        {" "}and run the embed step, then return to ask questions.
      </p>
    </div>
  );
}

function ErrorMessage({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="msg-in flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand shadow-sm">
        <UsefulBrainMark className="size-5" tone="dark" />
      </span>
      <div className="flex-1 rounded-2xl border border-danger/25 bg-danger-soft px-4 py-3" role="alert">
        <p className="text-sm font-medium text-danger">{message}</p>
        {onRetry ? (
          <button
            className="btn btn-secondary mt-3 min-h-10 px-3 text-sm"
            onClick={onRetry}
            type="button"
          >
            Retry answer
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function buildEvidenceItems(
  groundedAnswer: GroundedAnswerResponse | null,
): EvidenceItem[] {
  if (!groundedAnswer) {
    return [];
  }
  return groundedAnswer.retrieval.results.map((result) => ({
    id: result.chunkId,
    label: result.citationLabel,
    labelNumber: result.citationLabel.replace(/[[\]]/g, ""),
    source: result.source,
    section: result.section,
    text: result.text,
    score: result.score,
    scoreLabel: `Score ${formatRetrievalScore(result.score)}`,
    rankLabel: `Rank ${result.rank}`,
    tokenEstimate: result.tokenEstimate,
  }));
}

export function filterCitedEvidence(
  groundedAnswer: GroundedAnswerResponse | null,
  retrievedItems: EvidenceItem[],
): EvidenceItem[] {
  if (!groundedAnswer) {
    return [];
  }
  const cited = new Set(
    groundedAnswer.structuredAnswer.paragraphs.flatMap(
      (paragraph) => paragraph.citations,
    ),
  );
  return retrievedItems.filter((item) => cited.has(item.label));
}
