"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { useMediaQuery } from "@/lib/use-media-query";
import { LayersIcon, PanelRightIcon } from "@/components/icons";
import { Button, IconButton } from "@/components/ui/button";
import type { ChatProgressView, SuggestionView } from "@/lib/contracts/chat-view";
import { DEFAULT_USEFUL_BRAIN_CONFIG } from "@/lib/useful-brain-config";

import { EmptyState, StatusLine, UserBubble } from "./answer";
import { ChatComposer } from "./chat-composer";

type ChatWorkspaceProps = {
  /** Banner above the head (View as). */
  banner?: ReactNode;
  title: string;
  /** Evidence panel toggle in the head. Omitted when no answer has evidence. */
  panelToggle?: { open: boolean; onToggle: () => void };
  /** The rendered turns, in order. */
  children: ReactNode;
  hasTurns: boolean;
  ready: boolean;
  onOpenKnowledge?: () => void;
  placeholder: string;
  suggestions: SuggestionView[];
  onSubmit: (value: string) => void;
  onStop?: () => void;
  pendingQuestion: string | null;
  progress: ChatProgressView | null;
  stopError?: string | null;
  stopping?: boolean;
};

export function ChatWorkspace({
  banner,
  title,
  panelToggle,
  children,
  hasTurns,
  ready,
  onOpenKnowledge = () => {},
  placeholder,
  suggestions,
  onSubmit,
  onStop,
  pendingQuestion,
  progress,
  stopError = null,
  stopping = false,
}: ChatWorkspaceProps) {
  const [question, setQuestion] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasConversation = hasTurns || pendingQuestion !== null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [hasTurns, pendingQuestion, progress]);

  function send(value = question) {
    const next = value.trim();
    if (!next || !ready || pendingQuestion) {
      return;
    }
    onSubmit(next);
    setQuestion("");
  }

  // The mobile shell header already carries menu, title and new chat; evidence
  // opens from the sources summary there.
  const mobile = useMediaQuery("(max-width: 767px)");

  const composer = (
    <ChatComposer
      disabled={!ready}
      onChange={setQuestion}
      onSend={() => send()}
      onStop={onStop}
      pending={pendingQuestion !== null}
      placeholder={placeholder}
      stopping={stopping}
      value={question}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {banner}
      {mobile ? null : (
        <header className="flex h-[52px] shrink-0 items-center gap-3 pl-6 pr-3">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink max-[1199px]:hidden">
            {title}
          </span>
          <span className="min-[1200px]:hidden flex-1" />
          {panelToggle ? (
            <span
              className={`rounded-[10px] ${panelToggle.open ? "bg-sunken" : ""}`}
            >
              <IconButton
                aria-label="Evidence"
                aria-pressed={panelToggle.open}
                onClick={panelToggle.onToggle}
              >
                <PanelRightIcon className="size-4" />
              </IconButton>
            </span>
          ) : null}
        </header>
      )}

      {!ready ? (
        <SetupNotice onOpenKnowledge={onOpenKnowledge} />
      ) : !hasConversation ? (
        <div className="uv-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[768px] px-4 min-[768px]:px-6">
            <EmptyState
              composer={composer}
              onPick={(picked) => setQuestion(picked)}
              suggestions={suggestions}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="uv-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[768px] flex-col gap-8 px-4 pb-6 pt-4 min-[768px]:px-6">
              {children}
              {pendingQuestion ? (
                <div className="flex flex-col gap-4">
                  <UserBubble>{pendingQuestion}</UserBubble>
                  {progress ? <StatusLine progress={progress} /> : null}
                  {stopError ? (
                    <p className="m-0 text-xs text-danger" role="alert">
                      {stopError}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div aria-hidden="true" ref={bottomRef} />
            </div>
          </div>
          <div className="mx-auto w-full max-w-[768px] shrink-0 px-4 pb-6 min-[768px]:px-6">
            {composer}
          </div>
        </>
      )}
    </div>
  );
}

function SetupNotice({ onOpenKnowledge }: { onOpenKnowledge: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[768px] flex-1 flex-col items-start gap-3 px-6 pt-24">
      <span className="grid size-10 place-items-center rounded-[10px] bg-sunken text-ink-muted">
        <LayersIcon className="size-5" />
      </span>
      <h2 className="m-0 text-base font-semibold text-ink">Set up sources</h2>
      <p className="m-0 text-sm text-ink-muted">
        Chat becomes available after a ready generation is promoted.
      </p>
      <Button onClick={onOpenKnowledge} variant="primary">
        Open {DEFAULT_USEFUL_BRAIN_CONFIG.knowledgeLabel}
      </Button>
    </div>
  );
}
