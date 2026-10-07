import { describe, expect, it } from "vitest";

import { groupConversations } from "./groups";

// Local-time constructor so the test holds in any timezone.
const NOW = new Date(2026, 9, 8, 15, 30).getTime();
const at = (day: number, hour = 9) => new Date(2026, 9, day, hour).getTime();

const row = (id: string, updatedAt: number) => ({ id, updatedAt });

describe("groupConversations", () => {
  it("returns no groups for no chats", () => {
    expect(groupConversations([], NOW)).toEqual([]);
  });

  it("puts chats from the same calendar day in Today, newest first", () => {
    const groups = groupConversations(
      [row("early", at(8, 1)), row("late", at(8, 14))],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Today");
    expect(groups[0].items.map((item) => item.id)).toEqual(["late", "early"]);
  });

  it("treats just before local midnight as Previous 7 days, not Today", () => {
    const groups = groupConversations([row("yesterday", at(7, 23))], NOW);
    expect(groups.map((group) => group.label)).toEqual(["Previous 7 days"]);
  });

  it("keeps the seven calendar days before today and sends older chats to Older", () => {
    const groups = groupConversations(
      [row("edge", at(1, 0)), row("old", at(1) - 5 * 86_400_000)],
      NOW,
    );
    const labels = groups.map((group) => group.label);
    expect(labels).toEqual(["Previous 7 days", "Older"]);
    expect(groups[0].items[0].id).toBe("edge");
    expect(groups[1].items[0].id).toBe("old");
  });

  it("never drops a chat and puts a future timestamp in Today", () => {
    const items = [
      row("future", NOW + 3_600_000),
      row("today", at(8, 2)),
      row("week", at(3)),
      row("ancient", at(1) - 90 * 86_400_000),
    ];
    const groups = groupConversations(items, NOW);
    expect(groups.flatMap((group) => group.items)).toHaveLength(items.length);
    expect(groups.map((group) => group.label)).toEqual([
      "Today",
      "Previous 7 days",
      "Older",
    ]);
    expect(groups[0].items[0].id).toBe("future");
  });

  it("omits empty groups", () => {
    const groups = groupConversations([row("week", at(4))], NOW);
    expect(groups.map((group) => group.label)).toEqual(["Previous 7 days"]);
  });
});
