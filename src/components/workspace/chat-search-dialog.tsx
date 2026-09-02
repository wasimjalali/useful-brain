"use client";

import { useMemo, useState } from "react";

import { ChatIcon, CloseIcon, NewChatIcon, SearchIcon } from "@/components/icons";
import { Dialog } from "@/components/ui/dialog";
import type { Conversation } from "@/lib/rag/chat-history";

export function ChatSearchDialog({
  conversations,
  onClose,
  onNewChat,
  onSelect,
}: {
  conversations: Conversation[];
  onClose: () => void;
  onNewChat: () => void;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return conversations;
    }
    return conversations.filter((conversation) =>
      conversation.title.toLowerCase().includes(needle),
    );
  }, [conversations, query]);

  return (
    <Dialog ariaLabel="Search chats" maxWidth="max-w-2xl" onClose={onClose}>
      <div className="search-modal">
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="chat-search">
            Search chats
          </label>
          <div className="field-input flex min-h-10 flex-1 items-center gap-2 px-3">
            <SearchIcon className="size-4 text-ink-faint" />
            <input
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
              id="chat-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats..."
              type="search"
              value={query}
            />
          </div>
          <button
            aria-label="Close search"
            className="icon-btn size-10"
            onClick={onClose}
            type="button"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        <button
          className="nav-item w-full text-sm"
          onClick={onNewChat}
          type="button"
        >
          <NewChatIcon className="size-4" />
          New chat
        </button>

        <div>
          <p className="px-2 pb-2 text-[11px] text-ink-faint">Recents</p>
          {matches.length === 0 ? (
            <p className="px-2 text-sm text-ink-muted">No matching chats.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {matches.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    className="nav-item w-full text-sm"
                    onClick={() => onSelect(conversation.id)}
                    type="button"
                  >
                    <ChatIcon className="size-4 shrink-0" />
                    <span className="truncate">{conversation.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
