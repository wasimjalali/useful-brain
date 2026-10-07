"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { ArrowUpIcon, SquareIcon } from "@/components/icons";

const LINE_HEIGHT = 24;
const MAX_HEIGHT = 192;

type ChatComposerProps = {
  disabled?: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  pending: boolean;
  placeholder: string;
  stopping?: boolean;
  value: string;
};

/**
 * A 52px pill that grows into a 22px-radius box when the text wraps. The
 * button is Send (36px circle), and Stop while an answer is running.
 */
export function ChatComposer({
  disabled = false,
  onChange,
  onSend,
  onStop,
  pending,
  placeholder,
  stopping = false,
  value,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [height, setHeight] = useState(LINE_HEIGHT);
  const expanded = height > LINE_HEIGHT + 4;
  const hasText = value.trim().length > 0;

  useLayoutEffect(() => {
    const field = textareaRef.current;
    if (!field) {
      return;
    }
    field.style.height = "0px";
    const next = Math.min(Math.max(field.scrollHeight, LINE_HEIGHT), MAX_HEIGHT);
    field.style.height = `${next}px`;
    setHeight(next);
  }, [value]);

  function submit() {
    if (disabled || pending || !hasText) {
      return;
    }
    onSend();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  const stopMode = pending && onStop;

  return (
    <form
      className={`flex w-full bg-bubble shadow-[0_0_0_1px_var(--edge),var(--lift)] transition-shadow duration-[120ms] focus-within:shadow-[0_0_0_1px_var(--border-strong),var(--lift)] ${
        expanded
          ? "flex-col rounded-[22px] pb-2 pl-5 pr-2 pt-3.5"
          : "min-h-[52px] items-center rounded-full pl-5 pr-2"
      }`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="sr-only" htmlFor="chat-question">
        Question
      </label>
      <textarea
        className={`w-full min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-faint-text focus:outline-none disabled:text-ink-faint-text ${
          height >= MAX_HEIGHT ? "overflow-y-auto" : "overflow-hidden"
        }`}
        disabled={disabled}
        id="chat-question"
        maxLength={2000}
        name="question"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={value}
      />
      <div className={expanded ? "flex justify-end pt-1.5" : "flex shrink-0"}>
        {stopMode ? (
          <button
            aria-label="Stop"
            className="ub-ring grid size-9 place-items-center rounded-full bg-accent text-accent-ink transition-opacity duration-[120ms] hover:opacity-[0.86] disabled:opacity-60"
            disabled={stopping}
            onClick={onStop}
            type="button"
          >
            <SquareIcon className="size-3.5" />
          </button>
        ) : (
          <button
            aria-label="Send"
            className={`ub-ring grid size-9 place-items-center rounded-full transition-colors duration-[120ms] ${
              hasText && !disabled && !pending
                ? "bg-accent text-accent-ink hover:opacity-[0.86]"
                : "cursor-not-allowed bg-sunken text-ink-faint"
            }`}
            disabled={disabled || pending || !hasText}
            type="submit"
          >
            <ArrowUpIcon className="size-4" />
          </button>
        )}
      </div>
    </form>
  );
}
