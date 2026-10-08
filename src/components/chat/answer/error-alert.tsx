import { InlineAlert } from "@/components/ui/inline-alert";

const STOPPED = "The answer stopped before it finished. Your question is saved.";
const UNAVAILABLE = "The knowledge base is unavailable right now. Your question is saved.";
const SIGNED_OUT = "Your session has ended. Sign in to continue.";

export function ErrorAlert({
  partialText,
  onRetry,
  onSignIn,
  message,
  retryable = true,
  signedOut = false,
  unavailable = false,
}: {
  partialText?: string;
  onRetry: () => void;
  onSignIn?: () => void;
  /** Reason to show for a failure that retrying will not fix. */
  message?: string | null;
  retryable?: boolean;
  signedOut?: boolean;
  /** Retrieval or the model was down: say so instead of "stopped". */
  unavailable?: boolean;
}) {
  const action = signedOut
    ? onSignIn
      ? { label: "Sign in", onClick: onSignIn }
      : undefined
    : retryable
      ? { label: "Retry", onClick: onRetry }
      : undefined;
  return (
    <div className="flex flex-col gap-3">
      {partialText ? <p className="m-0 text-[15px] leading-6 text-ink-muted">{partialText}</p> : null}
      <InlineAlert action={action}>
        {signedOut ? SIGNED_OUT : retryable ? (unavailable ? UNAVAILABLE : STOPPED) : (message ?? STOPPED)}
      </InlineAlert>
    </div>
  );
}
