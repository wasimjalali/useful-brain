import { InlineAlert } from "@/components/ui/inline-alert";

export function ActivityError({ onRetry }: { onRetry: () => void }) {
  return (
    <InlineAlert action={{ label: "Retry", onClick: onRetry }}>
      {"Couldn't load activity. The operations database didn't respond."}
    </InlineAlert>
  );
}
