export type ChatGroupLabel = "Today" | "Previous 7 days" | "Older";

export type ChatGroup<T> = { label: ChatGroupLabel; items: T[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Buckets chats by local calendar day: Today, the seven days before today,
 * then Older. Empty groups are omitted and no chat is ever dropped. A
 * timestamp in the future (clock skew) counts as Today.
 */
export function groupConversations<T extends { updatedAt: number }>(
  items: readonly T[],
  now: number,
): ChatGroup<T>[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();
  const weekStart = todayStart - 7 * DAY_MS;

  const buckets: Record<ChatGroupLabel, T[]> = {
    Today: [],
    "Previous 7 days": [],
    Older: [],
  };
  for (const item of items) {
    const label: ChatGroupLabel =
      item.updatedAt >= todayStart
        ? "Today"
        : item.updatedAt >= weekStart
          ? "Previous 7 days"
          : "Older";
    buckets[label].push(item);
  }

  const order: ChatGroupLabel[] = ["Today", "Previous 7 days", "Older"];
  return order
    .filter((label) => buckets[label].length > 0)
    .map((label) => ({
      label,
      items: [...buckets[label]].sort((a, b) => b.updatedAt - a.updatedAt),
    }));
}
