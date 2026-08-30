"use client";

import type { KeyboardEvent } from "react";

import { SendIcon } from "@/components/icons";

type ChatComposerProps = {
  disabled: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  pending: boolean;
  stopping?: boolean;
  value: string;
};

export function ChatComposer({
  disabled,
  onChange,
  onSend,
  onStop,
  pending,
  stopping = false,
  value,
}: ChatComposerProps) {
  function submit() {
    if (disabled || pending || !value.trim()) {
      return;
    }
    onSend();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="pb-3 pt-2 sm:pb-6">
      <form
        className="mx-auto w-full max-w-3xl px-4 sm:px-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="field-input rounded-2xl bg-surface p-2 shadow-raise">
          <label className="sr-only" htmlFor="chat-question">
            Question
          </label>
          <textarea
            className="min-h-[48px] max-h-48 w-full resize-none border-0 bg-transparent px-3 py-2.5 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-faint focus:outline-none focus-visible:outline-none disabled:text-ink-faint sm:min-h-[64px] sm:py-3"
            disabled={disabled}
            id="chat-question"
            maxLength={2000}
            name="question"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled
                ? "Promote a generation to start"
                : "Ask the knowledge base…"
            }
            rows={1}
            value={value}
          />
          <div className="flex items-center justify-between gap-3 px-1.5 pb-0.5">
            <span className="hidden text-xs text-ink-faint sm:inline">
              Enter to send · Shift+Enter for a new line
            </span>
            <span className="text-xs text-ink-faint sm:hidden">Enter to send</span>
            {pending && onStop ? (
              <button
                className="btn btn-secondary min-h-10 shrink-0 px-3 text-sm"
                disabled={stopping}
                onClick={onStop}
                type="button"
              >
                {stopping ? "Stopping" : "Stop generating"}
              </button>
            ) : (
              <button
                aria-label="Generate answer"
                className="btn btn-primary size-10 shrink-0 rounded-full p-0"
                disabled={disabled || pending || value.trim().length === 0}
                type="submit"
              >
                <SendIcon className="size-[18px]" />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
