import { InlineAlert } from "@/components/ui/inline-alert";

export function ErrorAlert({ partialText, onRetry }: { partialText?: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      {partialText ? <p className="m-0 text-[15px] leading-6 text-ink-muted">{partialText}</p> : null}
      <InlineAlert action={{ label: "Retry", onClick: onRetry }}>
        The answer stopped before it finished. Your question is saved.
      </InlineAlert>
    </div>
  );
}
