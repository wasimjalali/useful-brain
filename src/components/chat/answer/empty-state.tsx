import type { ReactNode } from "react";

import type { SuggestionView } from "@/lib/contracts/chat-view";

export function EmptyState({
  composer,
  suggestions,
  onPick,
}: {
  composer: ReactNode;
  suggestions: SuggestionView[];
  onPick: (question: string) => void;
}) {
  return (
    <div className="pt-12 min-[768px]:pt-44">
      <h1 className="m-0 text-2xl font-semibold leading-8 text-ink">Ask about Northwind</h1>
      <p className="m-0 mt-1.5 text-[15px] leading-6 text-ink-muted">
        Every answer cites the documents you can read.
      </p>
      <div className="mt-7">{composer}</div>
      <ul className="m-0 mt-6 flex list-none flex-col p-0">
        {suggestions.map((suggestion) => (
          <li key={suggestion.question}>
            <button
              className="ub-ring group flex h-11 w-full items-center gap-4 rounded-[10px] px-3 text-left transition-colors duration-[120ms] hover:bg-sunken"
              onClick={() => onPick(suggestion.question)}
              type="button"
            >
              <span className="flex-1 truncate text-sm text-ink-muted group-hover:text-ink">
                {suggestion.question}
              </span>
              <span className="shrink-0 text-xs text-ink-faint-text">{suggestion.department}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
