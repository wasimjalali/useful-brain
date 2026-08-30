"use client";

import { useState } from "react";

import {
  CopyIcon,
  RetryIcon,
  SourceIcon,
  ThumbDownIcon,
  ThumbUpIcon,
} from "@/components/icons";
import { UsefulBrainMark } from "@/components/useful-brain-logo";
import { StatusLabel } from "@/components/ui/status-label";
import { DEFAULT_USEFUL_BRAIN_CONFIG } from "@/lib/useful-brain-config";
import type { GroundedAnswerResponse } from "@/lib/rag/grounded-answer";

import type { EvidenceItem } from "./evidence-inspector";

export type AnswerAction = "copy" | "retry" | "helpful" | "unhelpful";
export type AnswerFeedback = "helpful" | "unhelpful" | null;

type ConversationTurnProps = {
  activeEvidenceId: string | null;
  answer: GroundedAnswerResponse;
  onAction?: (action: AnswerAction) => void;
  onFocusEvidence: (id: string, matchedSentence: string) => void;
  onOpenSources: () => void;
  onRetry: (question: string) => void;
};

export function ConversationTurn({
  activeEvidenceId,
  answer,
  onAction,
  onFocusEvidence,
  onOpenSources,
  onRetry,
}: ConversationTurnProps) {
  const [feedback, setFeedback] = useState<AnswerFeedback>(null);
  const [copied, setCopied] = useState(false);
  const grounded = answer.structuredAnswer.answerType === "grounded";
  const evidence = buildEvidenceItems(answer);
  const citedItems = filterCitedEvidence(answer, evidence);

  function copyAnswer() {
    void navigator.clipboard?.writeText(answer.answer);
    setCopied(true);
    onAction?.("copy");
  }

  function setAnswerFeedback(next: Exclude<AnswerFeedback, null>) {
    const nextFeedback = feedback === next ? null : next;
    setFeedback(nextFeedback);
    if (nextFeedback) {
      onAction?.(nextFeedback);
    }
  }

  return (
    <div className="msg-in flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand shadow-sm">
        <UsefulBrainMark className="size-5" tone="dark" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">
            {DEFAULT_USEFUL_BRAIN_CONFIG.productName}
          </span>
          {!grounded ? (
            <StatusLabel tone="warning">insufficient evidence</StatusLabel>
          ) : null}
          {(answer.vectorDegradedCount ?? 0) > 0 ? (
            <StatusLabel tone="warning">keyword-only retrieval</StatusLabel>
          ) : null}
          {answer.assumedPrincipal ? (
            <StatusLabel tone="neutral">as {answer.assumedPrincipal.userId}</StatusLabel>
          ) : null}
        </div>

        <div className="flex flex-col gap-3.5 text-[15px] leading-7 text-ink">
          {answer.structuredAnswer.paragraphs.map((paragraph, index) => (
            <p className="break-words" key={index}>
              {stripCitationMarkers(paragraph.text)}
              {grounded
                ? paragraph.citations.map((citation) => {
                    const item = citedItems.find(
                      (evidenceItem) => evidenceItem.label === citation,
                    );
                    if (!item) {
                      return null;
                    }
                    return (
                      <button
                        aria-label={`Open source ${item.source}, ${item.section}`}
                        className="cite citation-control ml-1 align-baseline"
                        data-active={
                          item.id === activeEvidenceId ? "true" : undefined
                        }
                        key={`${index}-${citation}`}
                        onClick={() =>
                          onFocusEvidence(item.id, stripCitationMarkers(paragraph.text))
                        }
                        type="button"
                      >
                        {citation}
                      </button>
                    );
                  })
                : null}
            </p>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {evidence.length > 0 ? (
            <button
              aria-label={`Evidence: ${citedItems.length} cited of ${evidence.length} retrieved`}
              className="source-trigger min-h-10 px-3 text-xs font-medium"
              onClick={onOpenSources}
              type="button"
            >
              <SourceIcon className="size-3.5" />
              Evidence
              <span className="tnum text-accent-deep">{evidence.length}</span>
            </button>
          ) : null}
          <AnswerActionButton
            active={copied}
            label={copied ? "Copied answer" : "Copy answer"}
            onClick={copyAnswer}
          >
            <CopyIcon className="size-4" />
          </AnswerActionButton>
          <AnswerActionButton
            label="Retry question"
            onClick={() => {
              onAction?.("retry");
              onRetry(answer.question);
            }}
          >
            <RetryIcon className="size-4" />
          </AnswerActionButton>
          <AnswerActionButton
            active={feedback === "helpful"}
            label="Mark answer helpful"
            onClick={() => setAnswerFeedback("helpful")}
            toggle
          >
            <ThumbUpIcon className="size-4" />
          </AnswerActionButton>
          <AnswerActionButton
            active={feedback === "unhelpful"}
            label="Mark answer unhelpful"
            onClick={() => setAnswerFeedback("unhelpful")}
            toggle
          >
            <ThumbDownIcon className="size-4" />
          </AnswerActionButton>
        </div>
      </div>
    </div>
  );
}

function AnswerActionButton({
  active = false,
  children,
  label,
  onClick,
  toggle = false,
}: {
  active?: boolean;
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  toggle?: boolean;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={toggle ? active : undefined}
      className="answer-action size-10"
      data-active={active ? "true" : undefined}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function buildEvidenceItems(answer: GroundedAnswerResponse): EvidenceItem[] {
  return answer.retrieval.results.map((result) => ({
    id: result.chunkId,
    label: result.citationLabel,
    labelNumber: result.citationLabel.replace(/[[\]]/g, ""),
    source: result.source,
    section: result.section,
    text: result.text,
    score: result.score,
    scoreLabel: "",
    rankLabel: "",
    tokenEstimate: result.tokenEstimate,
    generationId: answer.corpusGenerationId ?? "Unknown",
    vectorScore: result.vectorScore ?? null,
    keywordScore: result.keywordScore ?? null,
    fusedScore: result.fusedScore ?? null,
    rerankScore: result.rerankScore ?? null,
  }));
}

function filterCitedEvidence(
  answer: GroundedAnswerResponse,
  evidence: EvidenceItem[],
) {
  const cited = new Set(
    answer.structuredAnswer.paragraphs.flatMap((paragraph) => paragraph.citations),
  );
  return evidence.filter((item) => cited.has(item.label));
}

function stripCitationMarkers(text: string): string {
  return text.replace(/\s*\[\d+\]/g, "").trim();
}
