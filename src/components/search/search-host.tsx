"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { searchAll } from "@/app/library-actions";
import { useShell } from "@/components/shell/shell-context";
import type { SearchResponse } from "@/lib/contracts/library";
import type { SearchDocumentRowView } from "@/lib/contracts/library-view";
import { departmentLabel } from "@/lib/labels";

import { SearchDialog, type SearchChatRow } from "./search-dialog";

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

const normalizeTitle = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * One row per distinct normalized title, at the position of its first hit. The row opens the
 * most recently updated chat of the group (the server's order breaks ties and covers hits whose
 * date the sidebar cache lacks).
 */
export function groupChatsByTitle(
  hits: SearchResponse["chats"],
  updatedAt: Map<string, number>,
  now: number,
): SearchChatRow[] {
  const groups = new Map<string, SearchResponse["chats"]>();
  for (const hit of hits) {
    const key = normalizeTitle(hit.title);
    const group = groups.get(key);
    if (group) group.push(hit);
    else groups.set(key, [hit]);
  }
  return [...groups.values()].map((group) => {
    // Server order is by updated_at, so the first hit wins unless both timestamps are known
    // and a later one is strictly newer. A missing timestamp (stale sidebar cache) never loses.
    const best = group.reduce((a, b) => {
      const ta = updatedAt.get(a.id);
      const tb = updatedAt.get(b.id);
      return ta !== undefined && tb !== undefined && tb > ta ? b : a;
    });
    return {
      id: best.id,
      title: best.title,
      titleMatches: best.titleMatches,
      dateLabel: dateLabel(updatedAt.get(best.id), now),
      ...(group.length > 1 ? { count: group.length } : {}),
    };
  });
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
  const chats = groupChatsByTitle(results.chats, updatedAt, now);
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
        // router.push follows, so skip the history entry newChat would add.
        newChat({ pushUrl: false });
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
