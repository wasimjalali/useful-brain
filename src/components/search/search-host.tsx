"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { searchAll } from "@/app/library-actions";
import { useShell } from "@/components/shell/shell-context";
import type { SearchResponse } from "@/lib/contracts/library";
import type { SearchChatRowView, SearchDocumentRowView } from "@/lib/contracts/library-view";
import { departmentLabel } from "@/lib/library/mappers";

import { SearchDialog } from "./search-dialog";

const DEBOUNCE_MS = 200;
const MIN_QUERY = 2;
const DAY_MS = 86_400_000;

function dateLabel(updatedAt: number | undefined, now: number): string {
  if (updatedAt === undefined) {
    return "";
  }
  const days = Math.floor((now - updatedAt) / DAY_MS);
  if (days < 1) return "Today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

export function SearchHost({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { conversations, newChat } = useShell();
  const [query, setQuery] = useState("");
  const [settled, setSettled] = useState<
    { q: string; data: SearchResponse; error: string | null } | null
  >(null);
  const [now] = useState(() => Date.now());

  const q = query.trim();
  const active = q.length >= MIN_QUERY;
  const current = active && settled?.q === q ? settled : null;
  const loading = active && current === null;
  const results = current?.data ?? { chats: [], documents: [] };
  const error = current?.error ?? null;

  useEffect(() => {
    if (q.length < MIN_QUERY) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchAll(q).then((result) => {
        if (!cancelled) {
          setSettled(
            result.ok
              ? { q, data: result.data, error: null }
              : { q, data: { chats: [], documents: [] }, error: result.error.message },
          );
        }
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const updatedAt = useMemo(
    () => new Map(conversations.map((conversation) => [conversation.id, conversation.updatedAt])),
    [conversations],
  );
  const chats: SearchChatRowView[] = results.chats.map((hit) => ({
    id: hit.id,
    title: hit.title,
    titleMatches: hit.titleMatches,
    dateLabel: dateLabel(updatedAt.get(hit.id), now),
  }));
  const documents: SearchDocumentRowView[] = results.documents.map((hit) => ({
    id: hit.id,
    title: hit.title,
    titleMatches: hit.titleMatches,
    department: hit.department ? departmentLabel(hit.department) : "General",
    snippet: hit.snippet,
  }));

  function go(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <SearchDialog
      chats={chats}
      documents={documents}
      error={error}
      loading={loading}
      onAskDocument={(id) => {
        newChat();
        go(`/chat?scope=${encodeURIComponent(id)}`);
      }}
      onClose={onClose}
      onOpenChat={(id) => go(`/chat/${encodeURIComponent(id)}`)}
      onOpenDocument={(id) => go(`/chat?doc=${encodeURIComponent(id)}`)}
      onQueryChange={setQuery}
      query={query}
    />
  );
}
