import { describe, expect, it } from "vitest";

import { addCitationLabels, PROMPT_VERSION } from "../answer/contract";
import {
  deriveServerConversationTitle,
  pairCompletedHistoryTurns,
  persistThenRelease,
  trimStoredHistory,
} from "./conversations";

describe("conversation helpers", () => {
  it("derives a bounded title from the first question", () => {
    expect(deriveServerConversationTitle("  Can   I return an opened product?  ")).toBe(
      "Can I return an opened product?",
    );
    expect(deriveServerConversationTitle("x".repeat(80))).toHaveLength(60);
  });

  it("keeps only the newest bounded completed history", () => {
    const history = Array.from({ length: 8 }, (_, index) => ({
      question: `Question ${index}`,
      answer: `Answer ${index}`,
    }));
    expect(trimStoredHistory(history, 3, 10_000)).toEqual(history.slice(-3));
  });

  it("pairs legacy null-parent assistants sequentially without dropping them", () => {
    expect(
      pairCompletedHistoryTurns([
        {
          id: "u-legacy",
          role: "user",
          content: "legacy question",
          status: "completed",
          parent_user_message_id: null,
        },
        {
          id: "a-legacy",
          role: "assistant",
          content: "legacy answer",
          status: "completed",
          parent_user_message_id: null,
        },
        {
          id: "u-linked",
          role: "user",
          content: "linked question",
          status: "completed",
          parent_user_message_id: null,
        },
        {
          id: "a-linked",
          role: "assistant",
          content: "linked answer",
          status: "completed",
          parent_user_message_id: "u-linked",
        },
      ]),
    ).toEqual([
      { question: "legacy question", answer: "legacy answer" },
      { question: "linked question", answer: "linked answer" },
    ]);
  });

  it("does not let a null-parent assistant consume a later parent-linked user", () => {
    expect(
      pairCompletedHistoryTurns([
        {
          id: "u-linked",
          role: "user",
          content: "linked question",
          status: "completed",
          parent_user_message_id: null,
        },
        {
          id: "u-legacy",
          role: "user",
          content: "legacy question",
          status: "completed",
          parent_user_message_id: null,
        },
        {
          id: "a-legacy",
          role: "assistant",
          content: "legacy answer",
          status: "completed",
          parent_user_message_id: null,
        },
        {
          id: "a-linked",
          role: "assistant",
          content: "linked answer",
          status: "completed",
          parent_user_message_id: "u-linked",
        },
      ]),
    ).toEqual([
      { question: "legacy question", answer: "legacy answer" },
      { question: "linked question", answer: "linked answer" },
    ]);
  });

  it("does not let a null-parent assistant consume a failed parent-linked user", () => {
    expect(
      pairCompletedHistoryTurns([
        {
          id: "u-linked",
          role: "user",
          content: "linked question",
          status: "completed",
          parent_user_message_id: null,
        },
        {
          id: "u-legacy",
          role: "user",
          content: "legacy question",
          status: "completed",
          parent_user_message_id: null,
        },
        {
          id: "a-failed",
          role: "assistant",
          content: "failed answer",
          status: "failed",
          parent_user_message_id: "u-linked",
        },
        {
          id: "a-legacy",
          role: "assistant",
          content: "legacy answer",
          status: "completed",
          parent_user_message_id: null,
        },
      ]),
    ).toEqual([{ question: "legacy question", answer: "legacy answer" }]);
  });

  it("persists durable state before releasing the run lock", async () => {
    const order: string[] = [];
    const evidence = addCitationLabels([
      {
        rank: 1,
        score: 0.9,
        chunkId: "chunk-a",
        source: "policy.md",
        section: "Leave",
        text: "Leave accrues monthly.",
        tokenEstimate: 4,
      },
    ]);
    expect(evidence[0].citationLabel).toBe("[1]");
    expect(PROMPT_VERSION).toBe("grounded-answer.v3");
    await persistThenRelease({
      persist: async () => {
        order.push("persist");
        return { ok: true };
      },
      release: async () => {
        order.push("release");
        return { ok: true };
      },
    });
    expect(order).toEqual(["persist", "release"]);
  });

  it("does not release the lock when persist throws", async () => {
    const order: string[] = [];
    await expect(
      persistThenRelease({
        persist: async () => {
          order.push("persist");
          throw new Error("d1 write failed");
        },
        release: async () => {
          order.push("release");
          return { ok: true };
        },
      }),
    ).rejects.toThrow(/d1 write failed/);
    expect(order).toEqual(["persist"]);
  });
});
