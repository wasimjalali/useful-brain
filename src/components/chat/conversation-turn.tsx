"use client";

import {
  AnswerActions,
  AnswerText,
  ApprovalCard,
  ErrorAlert,
  NoEvidence,
  RestrictedNote,
  SourcesRow,
  SourcesSummary,
} from "./answer";
import { approvalCardView } from "./approval-card-view";
import { paragraphDisplayViews, readersPhrase, sourceRefs } from "./answer-view";
import type { ChatTurnState } from "./turn-model";
import type { FeedbackValue } from "@/lib/contracts/chat-view";

export type AssistantTurnProps = {
  turn: ChatTurnState;
  /** Documents the asker can read, for "Searched N documents". */
  documentsSearched: number;
  mobile: boolean;
  now: number;
  approvalBusy: boolean;
  /** Short failure text for the last action on this turn (feedback, request, approval). */
  actionError: string | null;
  /** False for turns Brain never stored (view as): no feedback or request. */
  stored: boolean;
  onRetry: () => void;
  onCopy: () => void;
  onFeedback: (value: FeedbackValue | null) => void;
  onRequestDocument: () => void;
  onOpenEvidence: () => void;
  onApprove: () => void;
  onDeny: () => void;
  onOpenTicket: (ticketId: string) => void;
  onSignIn: () => void;
};

/** The assistant side of one turn. The working state is the status line in the workspace. */
export function AssistantTurn({
  turn,
  documentsSearched,
  mobile,
  now,
  approvalBusy,
  actionError,
  stored,
  onRetry,
  onCopy,
  onFeedback,
  onRequestDocument,
  onOpenEvidence,
  onApprove,
  onDeny,
  onOpenTicket,
  onSignIn,
}: AssistantTurnProps) {
  const answer = turn.answer;
  if (!answer) {
    return (
      <ErrorAlert
        message={turn.error}
        onRetry={onRetry}
        onSignIn={onSignIn}
        retryable={turn.errorRetryable !== false}
        signedOut={turn.errorCode === "AUTH_REQUIRED"}
      />
    );
  }

  if (answer.structuredAnswer.answerType === "insufficient_evidence") {
    const diagnostic = turn.adminDiagnostic?.[0];
    return (
      <div className="flex flex-col gap-3">
        <NoEvidence
          documentsSearched={documentsSearched}
          latencyMs={turn.latencyMs ?? undefined}
          onRequest={stored ? onRequestDocument : undefined}
          requested={turn.documentRequested ?? false}
        />
        {diagnostic ? (
          <RestrictedNote readers={readersPhrase(diagnostic.readers)} title={diagnostic.title} />
        ) : null}
        {actionError ? <ActionError message={actionError} /> : null}
      </div>
    );
  }

  const sources = sourceRefs(answer);
  const card = turn.approval ? approvalCardView(turn.approval, now) : null;
  return (
    <div className="flex flex-col gap-4">
      <AnswerText paragraphs={paragraphDisplayViews(answer)} />
      {card ? (
        <ApprovalCard
          approval={card}
          busy={approvalBusy}
          onApprove={onApprove}
          onDeny={onDeny}
          onOpenTicket={card.status === "done" ? () => onOpenTicket(card.ticketId) : undefined}
        />
      ) : null}
      {sources.length > 0 ? (
        mobile ? (
          <SourcesSummary
            onOpen={onOpenEvidence}
            passages={turn.passagesRetrieved ?? answer.retrieval.results.length}
            sources={sources}
          />
        ) : (
          <SourcesRow sources={sources} />
        )
      ) : null}
      <AnswerActions
        feedback={turn.feedback ?? null}
        latencyMs={turn.latencyMs ?? undefined}
        onCopy={onCopy}
        onFeedback={stored ? onFeedback : undefined}
        onRetry={onRetry}
        passages={turn.passagesRetrieved ?? undefined}
      />
      {actionError ? <ActionError message={actionError} /> : null}
    </div>
  );
}

function ActionError({ message }: { message: string }) {
  return (
    <p className="m-0 text-xs text-danger" role="alert">
      {message}
    </p>
  );
}
