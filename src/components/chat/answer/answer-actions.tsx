import { CopyIcon, RotateCcwIcon, ThumbsDownIcon, ThumbsUpIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/button";
import type { FeedbackValue } from "@/lib/contracts/chat-view";

import { formatSeconds, plural } from "./format";

export function AnswerActions({
  feedback,
  passages,
  latencyMs,
  onCopy,
  onRetry,
  onFeedback,
}: {
  feedback: FeedbackValue | null;
  passages?: number;
  latencyMs?: number;
  onCopy: () => void;
  onRetry: () => void;
  /** Called with the new value, or null when the current one is toggled off. */
  onFeedback?: (value: FeedbackValue | null) => void;
}) {
  const meta = [
    passages === undefined ? null : plural(passages, "passage", "passages"),
    latencyMs === undefined ? null : formatSeconds(latencyMs),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-center gap-1 max-[767px]:[&_.ub-iconbtn]:size-11">
      <IconButton aria-label="Copy" onClick={onCopy}>
        <CopyIcon className="size-4" />
      </IconButton>
      <IconButton aria-label="Retry" onClick={onRetry}>
        <RotateCcwIcon className="size-4" />
      </IconButton>
      {onFeedback ? (
        <>
          <IconButton
            aria-label="Good"
            aria-pressed={feedback === "up"}
            onClick={() => onFeedback(feedback === "up" ? null : "up")}
          >
            <ThumbsUpIcon className="size-4" />
          </IconButton>
          <IconButton
            aria-label="Bad"
            aria-pressed={feedback === "down"}
            onClick={() => onFeedback(feedback === "down" ? null : "down")}
          >
            <ThumbsDownIcon className="size-4" />
          </IconButton>
        </>
      ) : null}
      {meta ? <span className="ml-2 font-mono text-[11px] text-ink-faint-text">{meta}</span> : null}
    </div>
  );
}
