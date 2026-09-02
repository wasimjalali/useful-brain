"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { LayersIcon, NewChatIcon } from "@/components/icons";
import { UsefulBrainAvatar } from "@/components/useful-brain-logo";
import { DEFAULT_USEFUL_BRAIN_CONFIG } from "@/lib/useful-brain-config";
import type { GroundedAnswerResponse } from "@/lib/rag/grounded-answer";
import type { ChatTurn } from "@/lib/rag/chat-history";
import { formatRetrievalScore } from "@/lib/rag/retrieval";

import { ChatComposer } from "./chat-composer";
import { ConversationTurn } from "./conversation-turn";
import type { EvidenceItem } from "./evidence-inspector";

export { type EvidenceItem } from "./evidence-inspector";

const SAMPLE_QUESTIONS = [
  {
    label: "P1 first response",
    prompt: "What is the first-response target for a P1 support ticket?",
  },
  {
    label: "Support email",
    prompt: "What email address do customers use for support?",
  },
  {
    label: "Parental leave",
    prompt: "How much parental leave does Northwind provide?",
  },
  {
    label: "Refund window",
    prompt: "What is the refund window for an annual plan?",
  },
] as const;

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
  onOpenKnowledge?: () => void;
  onOpenSources: (turnId: string) => void;
  onStop?: () => void;
  onSubmit: (value: string) => void;
  pendingQuestion: string | null;
  ready: boolean;
  stopError?: string | null;
  stopping?: boolean;
  turns: ChatTurn[];
};

export function ChatWorkspace({
  askDisabled,
  canReset,
  focusedEvidenceId,
  onFocusEvidence,
  onNewChat,
  onOpenKnowledge = () => {},
  onOpenSources,
  onStop,
  onSubmit,
  pendingQuestion,
  ready,
  stopError = null,
  stopping = false,
  turns,
}: ChatWorkspaceProps) {
  const [question, setQuestion] = useState("");
  const [hoveredPrompt, setHoveredPrompt] = useState<string | null>(null);
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

  const showWelcome = ready && !hasConversation;

  return (
    <div className="flex h-full flex-col">
      {hasConversation ? (
        <header className="flex items-center justify-end gap-3 px-4 py-3 sm:px-6">
          {canReset ? (
            <button
              className="icon-btn size-9"
              onClick={onNewChat}
              type="button"
            >
              <NewChatIcon className="size-4" />
              <span className="sr-only">New chat</span>
            </button>
          ) : null}
        </header>
      ) : null}

      {showWelcome ? (
        <ChatWelcome
          composer={
            <ChatComposer
              disabled={askDisabled}
              flush
              onChange={setQuestion}
              onSend={() => send()}
              onStop={onStop}
              pending={pendingQuestion !== null}
              preview={question ? null : hoveredPrompt}
              stopping={stopping}
              value={question}
            />
          }
          activePrompt={question ? null : hoveredPrompt}
          onFillQuestion={(prompt) => {
            setQuestion(prompt);
            setHoveredPrompt(null);
          }}
          onPreviewQuestion={setHoveredPrompt}
        />
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
              {!ready ? (
                <SetupNotice onOpenKnowledge={onOpenKnowledge} />
              ) : (
                <div className="flex flex-col gap-6">
                  {turns.map((turn, index) => {
                    const isLast = index === turns.length - 1 && pendingQuestion === null;
                    return (
                      <div className="flex flex-col gap-6" key={turn.id}>
                        <UserMessage text={turn.question} />
                        <div aria-live={isLast ? "polite" : undefined}>
                          {turn.cancelled ? (
                            <StoppedMessage onRetry={() => send(turn.question)} />
                          ) : turn.error ? (
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
                      <ThinkingIndicator error={stopError} />
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
            onStop={onStop}
            pending={pendingQuestion !== null}
            stopping={stopping}
            value={question}
          />
        </>
      )}
    </div>
  );
}

function ChatWelcome({
  activePrompt,
  composer,
  onFillQuestion,
  onPreviewQuestion,
}: {
  activePrompt: string | null;
  composer: ReactNode;
  onFillQuestion: (value: string) => void;
  onPreviewQuestion: (value: string | null) => void;
}) {
  return (
    <div className="rise flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-16 text-center">
      <h1 className="max-w-2xl text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-[28px]">
        Ask a grounded question
      </h1>
      <p className="mt-2 max-w-md text-[15px] leading-6 text-ink-muted">
        Answers only from retrieved company documents. Missing evidence is a refusal.
      </p>
      <div className="mt-8 w-full max-w-2xl">{composer}</div>
      <div className="mt-5 flex w-full max-w-2xl flex-wrap justify-center gap-2">
        {SAMPLE_QUESTIONS.map((sample) => (
          <button
            aria-label={sample.prompt}
            className="chip"
            data-active={activePrompt === sample.prompt ? "true" : undefined}
            key={sample.prompt}
            onBlur={() => onPreviewQuestion(null)}
            onClick={() => onFillQuestion(sample.prompt)}
            onFocus={() => onPreviewQuestion(sample.prompt)}
            onMouseEnter={() => onPreviewQuestion(sample.prompt)}
            onMouseLeave={() => onPreviewQuestion(null)}
            type="button"
          >
            {sample.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="msg-in flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-sunken px-4 py-2.5 text-[15px] leading-6 text-ink">
        {text}
      </div>
    </div>
  );
}

function ThinkingIndicator({ error }: { error: string | null }) {
  return (
    <div className="msg-in flex gap-3" role="status">
      <UsefulBrainAvatar />
      <div className="pt-1.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
          />
          <span className="text-sm text-ink-muted">Retrieving evidence and checking citations.</span>
        </div>
        {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}

function StoppedMessage({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-sm text-ink-muted">Generation stopped.</p>
      <button
        className="mt-2 text-sm font-semibold text-accent-deep underline-offset-4 hover:underline"
        onClick={onRetry}
        type="button"
      >
        Retry question
      </button>
    </div>
  );
}

function SetupNotice({ onOpenKnowledge }: { onOpenKnowledge: () => void }) {
  return (
    <div className="rise rounded-2xl border border-dashed border-border-strong bg-surface p-6 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-xl bg-warning-soft text-warning">
        <LayersIcon className="size-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-ink">Set up sources</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-muted">
        Chat becomes available after a ready generation is promoted.
      </p>
      <button className="btn btn-primary mt-4 min-h-10 px-4 text-sm" onClick={onOpenKnowledge} type="button">
        Open {DEFAULT_USEFUL_BRAIN_CONFIG.knowledgeLabel}
      </button>
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
      <UsefulBrainAvatar />
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
    generationId: groundedAnswer.corpusGenerationId ?? "Unknown",
    vectorScore: result.vectorScore ?? null,
    keywordScore: result.keywordScore ?? null,
    fusedScore: result.fusedScore ?? null,
    rerankScore: result.rerankScore ?? null,
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
