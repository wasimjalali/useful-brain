import { ChevronUpIcon } from "@/components/icons";
import type { SourceRefView } from "@/lib/contracts/chat-view";

import { plural } from "./format";

/** Mobile: one 44px button that opens the evidence sheet. */
export function SourcesSummary({
  sources,
  passages,
  onOpen,
}: {
  sources: SourceRefView[];
  passages: number;
  onOpen: () => void;
}) {
  return (
    <button
      aria-label={`Sources: ${plural(passages, "passage", "passages")}`}
      className="ub-ring flex h-11 w-full items-center gap-2.5 rounded-[10px] bg-sunken px-3 text-left shadow-[inset_0_0_0_1px_var(--edge)]"
      onClick={onOpen}
      type="button"
    >
      <span aria-hidden="true" className="flex shrink-0 gap-1">
        {sources.map((source) => (
          <span
            className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md bg-bubble px-[5px] font-mono text-[11px] font-medium leading-none text-ink-muted"
            key={source.display ?? source.n}
          >
            {source.display ?? source.n}
          </span>
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
        {sources[0]?.document}
        <span className="font-normal text-ink-faint-text"> · {plural(passages, "passage", "passages")}</span>
      </span>
      <ChevronUpIcon className="size-4 shrink-0 text-ink-muted" />
    </button>
  );
}
