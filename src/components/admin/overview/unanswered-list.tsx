import { Button } from "@/components/ui/button";
import { UploadIcon } from "@/components/icons";
import type { UnansweredView } from "@/lib/contracts/admin-insights-view";

import { SectionHeader } from "./section-header";

export function UnansweredList({
  items,
  onAddDocument,
}: {
  items: UnansweredView[];
  onAddDocument: (item: UnansweredView) => void;
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <SectionHeader
        right={<span className="text-ink-faint-text">Asks</span>}
        title="Unanswered questions"
      >
        <span className="text-xs text-ink-faint-text">What to add next</span>
      </SectionHeader>
      <ul className="m-0 list-none p-0">
        {items.map((item) => (
          <li
            className="group -mx-3 grid min-h-[60px] grid-cols-[minmax(0,1fr)_auto_40px] items-center gap-x-4 rounded-[10px] px-3 py-2 transition-colors duration-[120ms] hover:bg-sunken focus-within:bg-sunken"
            key={item.id}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm leading-5 text-ink">{item.question}</span>
              <span className="text-xs leading-4 text-ink-faint-text">{item.meta}</span>
            </div>
            <span className="flex min-w-[116px] justify-end opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100">
              <Button
                aria-label={`Add document for: ${item.question}`}
                icon={<UploadIcon className="size-3.5" />}
                onClick={() => onAddDocument(item)}
                size={32}
                variant="secondary"
              >
                Add document
              </Button>
            </span>
            <span className="text-right text-sm font-medium text-ink">{item.asks}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
