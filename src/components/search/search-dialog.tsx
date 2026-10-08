"use client";

import { useId, useState, type ReactNode } from "react";

import {
  CornerDownLeftIcon,
  FileTextIcon,
  MessageSquareIcon,
  SearchIcon,
} from "@/components/icons";
import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import type { MatchRange } from "@/lib/contracts/library";
import type { SearchChatRowView, SearchDocumentRowView } from "@/lib/contracts/library-view";

function Matched({ text, ranges }: { text: string; ranges: MatchRange[] }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (start < cursor || end <= start || end > text.length) continue;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <span key={start} style={{ fontWeight: 600 }}>
        {text.slice(start, end)}
      </span>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/** A chat row; `count` is how many chats share its title (set when more than one). */
export type SearchChatRow = SearchChatRowView & { count?: number };

type Item =
  | { kind: "chat"; row: SearchChatRow }
  | { kind: "document"; row: SearchDocumentRowView };

export function SearchDialog({
  query,
  chats,
  documents,
  loading,
  error = null,
  onQueryChange,
  onOpenChat,
  onOpenDocument,
  onAskDocument,
  onClose,
}: {
  query: string;
  chats: SearchChatRow[];
  documents: SearchDocumentRowView[];
  loading: boolean;
  /** Set when the search itself failed; shown instead of an empty result. */
  error?: string | null;
  onQueryChange: (value: string) => void;
  onOpenChat: (chatId: string) => void;
  onOpenDocument: (documentId: string) => void;
  onAskDocument: (documentId: string) => void;
  onClose: () => void;
}) {
  const baseId = useId();
  const [selected, setSelected] = useState(0);
  const items: Item[] = [
    ...chats.map((row) => ({ kind: "chat" as const, row })),
    ...documents.map((row) => ({ kind: "document" as const, row })),
  ];
  const active = items.length === 0 ? -1 : Math.min(selected, items.length - 1);
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (items.length) setSelected(Math.min(active + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length) setSelected(Math.max(active - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[active];
      if (!item) return;
      if (event.metaKey || event.ctrlKey) {
        if (item.kind === "document") onAskDocument(item.row.id);
      } else if (item.kind === "chat") {
        onOpenChat(item.row.id);
      } else {
        onOpenDocument(item.row.id);
      }
    }
  }

  const rowClass =
    "flex w-full items-center gap-3 rounded-[10px] px-3 text-left text-[13px] data-[selected=true]:bg-sunken";
  const ret = (index: number) =>
    index === active ? (
      <CornerDownLeftIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
    ) : null;

  const listbox = (
    <div
      aria-label="Results"
      className="max-h-[420px] overflow-y-auto p-2"
      id={`${baseId}-list`}
      role="listbox"
    >
      {chats.length > 0 ? (
        <div aria-label="Chats" role="group">
          <p className="px-3 pb-1 pt-2 text-xs font-medium text-ink-faint-text">Chats</p>
          {chats.map((row, i) => (
            <div
              aria-selected={i === active}
              className={`${rowClass} h-10 cursor-pointer`}
              data-selected={i === active}
              id={optionId(i)}
              key={row.id}
              onClick={() => onOpenChat(row.id)}
              onMouseMove={() => setSelected(i)}
              role="option"
            >
              <MessageSquareIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
              <span className="min-w-0 flex-1 truncate">
                <Matched ranges={row.titleMatches} text={row.title} />
                {row.count && row.count > 1 ? (
                  <span className="ml-2 text-xs text-ink-faint-text">{`${row.count} chats`}</span>
                ) : null}
              </span>
              {i === active ? ret(i) : (
                <span className="text-xs text-ink-faint-text tabular-nums">{row.dateLabel}</span>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {documents.length > 0 ? (
        <div aria-label="Documents" role="group">
          <p className="px-3 pb-1 pt-2 text-xs font-medium text-ink-faint-text">Documents</p>
          {documents.map((row, j) => {
            const i = chats.length + j;
            return (
              <div
                aria-selected={i === active}
                className={`${rowClass} h-14 cursor-pointer`}
                data-selected={i === active}
                id={optionId(i)}
                key={row.id}
                onClick={() => onOpenDocument(row.id)}
                onMouseMove={() => setSelected(i)}
                role="option"
              >
                <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    <Matched ranges={row.titleMatches} text={row.title} />
                  </span>
                  {row.snippet ? (
                    <span className="block truncate text-xs text-ink-faint-text">{row.snippet}</span>
                  ) : null}
                </span>
                <span className="text-xs text-ink-faint-text">{row.department}</span>
                {ret(i)}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  return (
    <Dialog ariaLabel="Search" onClose={onClose} top={112} width={640}>
      <div className="flex h-14 items-center gap-3 border-b border-border px-4">
        <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
        <input
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          aria-controls={`${baseId}-list`}
          aria-expanded={items.length > 0}
          aria-label="Search chats and documents"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-faint-text"
          onChange={(event) => {
            setSelected(0);
            onQueryChange(event.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search chats and documents"
          role="combobox"
          value={query}
        />
        <Kbd>esc</Kbd>
      </div>
      {loading ? (
        <p className="px-5 py-8 text-[13px] text-ink-muted" role="status">
          Searching
        </p>
      ) : error ? (
        <p className="px-5 py-8 text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : items.length === 0 ? (
        <p className="px-5 py-8 text-[13px] text-ink-muted" role="status">
          {query.trim() ? `No results for “${query}”` : "Type to search your chats and documents"}
        </p>
      ) : (
        listbox
      )}
      <div className="flex h-10 items-center gap-4 border-t border-border px-4 text-xs text-ink-faint-text">
        <span className="flex items-center gap-1.5">
          <Kbd>↑↓</Kbd> Move
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> Open
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>⌘↵</Kbd> Ask about this
        </span>
        <span className="ml-auto tabular-nums">{`${chats.length} ${chats.length === 1 ? "chat" : "chats"} · ${documents.length} ${documents.length === 1 ? "document" : "documents"}`}</span>
      </div>
    </Dialog>
  );
}
