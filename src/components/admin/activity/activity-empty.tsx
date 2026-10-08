import { Button } from "@/components/ui/button";

export function ActivityEmpty({
  message,
  onShowAll,
}: {
  /** For example "No denied actions this week". */
  message: string;
  onShowAll: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5 py-10">
      <span className="text-sm font-medium text-ink">{message}</span>
      <Button onClick={onShowAll} size={32} variant="secondary">
        Show all outcomes
      </Button>
    </div>
  );
}
