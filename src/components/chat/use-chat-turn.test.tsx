import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GroundedAnswerResponse } from "@/lib/rag/grounded-answer";
import { actionSuccess, type ActionResult } from "@/lib/rag/app-errors";

import { useChatTurn, type AskAction } from "./use-chat-turn";

const answer: GroundedAnswerResponse = {
  question: "Can customers return opened products?",
  answer: "Opened products may be returned within 30 days. [1]",
  answerModel: "model",
  structuredAnswer: {
    answerType: "grounded",
    paragraphs: [
      { text: "Opened products may be returned within 30 days.", citations: ["[1]"] },
    ],
  },
  retrieval: {
    embeddingModel: "embed",
    embeddingDimensions: 1024,
    results: [],
  },
  conversationId: "conversation-1",
};

const never = () => new Promise<ActionResult<GroundedAnswerResponse>>(() => undefined);

function progressResponse(stage: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ stage, ...extra }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useChatTurn failures first", () => {
  it("ignores an empty question and never calls the action", async () => {
    const askAction = vi.fn(never);
    const { result } = renderHook(() => useChatTurn({ askAction }));
    await act(async () => {
      await result.current.submit("   ");
    });
    expect(askAction).not.toHaveBeenCalled();
    expect(result.current.pendingQuestion).toBeNull();
  });

  it("blocks a second submit while a turn is pending", async () => {
    const askAction = vi.fn(never);
    const { result } = renderHook(() => useChatTurn({ askAction }));
    act(() => {
      void result.current.submit("first");
    });
    await act(async () => {
      await result.current.submit("second");
    });
    expect(askAction).toHaveBeenCalledTimes(1);
  });

  it("turns a rejected action into an error turn that can be retried", async () => {
    const askAction = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(actionSuccess(answer));
    const { result } = renderHook(() => useChatTurn({ askAction }));
    await act(async () => {
      await result.current.submit("question");
    });
    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0].error).toBe("Could not generate an answer.");
    expect(result.current.pendingQuestion).toBeNull();

    await act(async () => {
      await result.current.submit("question");
    });
    expect(result.current.turns).toHaveLength(2);
    expect(result.current.turns[1].answer).not.toBeNull();
  });

  it("keeps a retryable failure flag and maps CANCELLED to a cancelled turn", async () => {
    const askAction = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "PROVIDER_TEMPORARY", message: "Try again.", retryable: true },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "CANCELLED", message: "Stopped.", retryable: false },
      });
    const { result } = renderHook(() => useChatTurn({ askAction }));
    await act(async () => {
      await result.current.submit("one");
    });
    expect(result.current.turns[0]).toMatchObject({
      error: "Try again.",
      errorRetryable: true,
    });
    await act(async () => {
      await result.current.submit("two");
    });
    expect(result.current.turns[1]).toMatchObject({ cancelled: true, error: null });
  });

  it("retries a failed first turn inside the conversation Brain already created", async () => {
    const askAction = vi
      .fn<AskAction>()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "PROVIDER_TEMPORARY",
          message: "The knowledge base is unavailable. Try the question again in a new turn.",
          retryable: true,
          turn: { conversationId: "conversation-1", assistantMessageId: "msg-failed" },
        },
      })
      .mockResolvedValue(actionSuccess(answer));
    const onConversationChange = vi.fn();
    const onNavigate = vi.fn();
    const { result } = renderHook(() => useChatTurn({ askAction, onConversationChange, onNavigate }));
    await act(async () => {
      await result.current.submit("first");
    });
    expect(result.current.conversationId).toBe("conversation-1");
    expect(result.current.turns[0]).toMatchObject({ messageId: "msg-failed", errorCode: "PROVIDER_TEMPORARY" });
    // The sidebar lists the conversation Brain created; a failure never navigates.
    expect(onConversationChange).toHaveBeenCalledWith(
      "conversation-1",
      [expect.objectContaining({ question: "first", answer: null })],
    );
    expect(onNavigate).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.retryTurn(result.current.turns[0].id);
    });
    expect(askAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ retryOfMessageId: "msg-failed", conversationId: "conversation-1" }),
    );
    expect(result.current.turns).toHaveLength(1);

    await act(async () => {
      await result.current.submit("second");
    });
    expect(askAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ question: "second", conversationId: "conversation-1" }),
    );
  });

  it("drops an answer that lands after the chat was reset", async () => {
    let resolveAsk: (value: ActionResult<GroundedAnswerResponse>) => void = () => {};
    const askAction = vi.fn(
      () =>
        new Promise<ActionResult<GroundedAnswerResponse>>((resolve) => {
          resolveAsk = resolve;
        }),
    );
    const onNavigate = vi.fn();
    const onConversationChange = vi.fn();
    const { result } = renderHook(() =>
      useChatTurn({ askAction, onNavigate, onConversationChange }),
    );
    act(() => {
      void result.current.submit("question");
    });
    act(() => result.current.reset());
    await act(async () => {
      resolveAsk(actionSuccess(answer));
    });
    expect(result.current.turns).toEqual([]);
    expect(result.current.pendingQuestion).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onConversationChange).not.toHaveBeenCalled();
  });

  it("drops an answer that lands after the hook unmounted", async () => {
    let resolveAsk: (value: ActionResult<GroundedAnswerResponse>) => void = () => {};
    const askAction = vi.fn(
      () =>
        new Promise<ActionResult<GroundedAnswerResponse>>((resolve) => {
          resolveAsk = resolve;
        }),
    );
    const onNavigate = vi.fn();
    const { result, unmount } = renderHook(() => useChatTurn({ askAction, onNavigate }));
    act(() => {
      void result.current.submit("question");
    });
    unmount();
    await act(async () => {
      resolveAsk(actionSuccess(answer));
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("reports a stop failure without cancelling the turn", async () => {
    const cancelAction = vi.fn(async () => ({
      ok: false as const,
      error: { code: "INTERNAL_ERROR" as const, message: "Could not stop.", retryable: true },
    }));
    const { result } = renderHook(() =>
      useChatTurn({ askAction: vi.fn(never), cancelAction }),
    );
    act(() => {
      void result.current.submit("question");
    });
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.stopError).toBe("Could not stop.");
    expect(result.current.pendingQuestion).toBe("question");
    expect(result.current.isStopping).toBe(false);
  });
});

describe("useChatTurn progress polling", () => {
  it("polls on a 2s loop while an answer is pending", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => progressResponse("drafting"));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    const { result } = renderHook(() => useChatTurn({ askAction: vi.fn(never) }));
    act(() => {
      void result.current.submit("question");
    });
    await act(async () => {});

    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/^\/api\/turns\//);
    expect(result.current.progress).toEqual({ kind: "writing" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("stops polling when the hook unmounts mid-turn", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => progressResponse("searching"));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() =>
      useChatTurn({ askAction: vi.fn(never) }),
    );
    act(() => {
      void result.current.submit("question");
    });
    await act(async () => {});
    const before = fetchMock.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("keeps at most one progress request in flight when responses are slow", async () => {
    let resolvePoll: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvePoll = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    const { result } = renderHook(() => useChatTurn({ askAction: vi.fn(never) }));
    act(() => {
      void result.current.submit("question");
    });
    await act(async () => {});
    expect(fetchMock.mock.calls.length).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(fetchMock.mock.calls.length).toBe(1);
    resolvePoll?.(progressResponse("drafting"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it("never lets a terminal progress snapshot complete the answer", async () => {
    const fetchMock = vi.fn(async () => progressResponse("done"));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    const { result } = renderHook(() => useChatTurn({ askAction: vi.fn(never) }));
    act(() => {
      void result.current.submit("question");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(result.current.pendingQuestion).toBe("question");
    expect(result.current.turns).toEqual([]);
    expect(result.current.progress).toEqual({ kind: "searching", readableDocuments: 0 });
  });

  it("survives a failing poll and keeps the loop going", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(progressResponse("reading", { passages: 8 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    const { result } = renderHook(() => useChatTurn({ askAction: vi.fn(never) }));
    act(() => {
      void result.current.submit("question");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.progress).toEqual({ kind: "reading", passages: 8 });
  });
});

describe("useChatTurn turns, stop and first-answer path", () => {
  it("sends only the server-owned conversation id on follow-ups and reports the first answer", async () => {
    const askAction = vi.fn<AskAction>(async () => actionSuccess(answer));
    const onNavigate = vi.fn();
    const onConversationChange = vi.fn();
    const { result } = renderHook(() =>
      useChatTurn({ askAction, onNavigate, onConversationChange }),
    );
    await act(async () => {
      await result.current.submit("first");
    });
    expect(onNavigate).toHaveBeenCalledWith("conversation-1");
    expect(onConversationChange).toHaveBeenCalledWith(
      "conversation-1",
      expect.arrayContaining([expect.objectContaining({ question: "first" })]),
    );
    expect(result.current.conversationId).toBe("conversation-1");

    await act(async () => {
      await result.current.submit("second");
    });
    const second = askAction.mock.calls[1] as unknown as [
      { conversationId: string | null; requestId: string },
    ];
    expect(second[0].conversationId).toBe("conversation-1");
    expect(second[0].requestId).toEqual(expect.any(String));
    expect(second[0]).not.toHaveProperty("history");
    expect(result.current.turns).toHaveLength(2);
  });

  it("sends the assumed principal when one is set", async () => {
    const askAction = vi.fn<AskAction>(async () => actionSuccess(answer));
    const principal = { userId: "maya", roles: ["support"], departments: ["support"] };
    const { result } = renderHook(() =>
      useChatTurn({ askAction, getAssumedPrincipal: () => principal }),
    );
    await act(async () => {
      await result.current.submit("question");
    });
    expect(askAction).toHaveBeenCalledWith(
      expect.objectContaining({ assumePrincipal: principal }),
    );
  });

  it("stops an in-flight answer by its request id and keeps a cancelled turn", async () => {
    const askAction = vi.fn(never);
    const cancelAction = vi.fn(async () =>
      actionSuccess({ conversationId: "conversation-cancelled" }),
    );
    const onConversationChange = vi.fn();
    const { result } = renderHook(() =>
      useChatTurn({ askAction, cancelAction, onConversationChange }),
    );
    act(() => {
      void result.current.submit("question");
    });
    await act(async () => {
      await result.current.stop();
    });
    expect(cancelAction).toHaveBeenCalledWith(expect.any(String));
    expect(result.current.turns).toEqual([
      expect.objectContaining({ question: "question", cancelled: true, answer: null }),
    ]);
    expect(result.current.pendingQuestion).toBeNull();
    expect(result.current.conversationId).toBe("conversation-cancelled");
    expect(onConversationChange).toHaveBeenCalledWith(
      "conversation-cancelled",
      expect.any(Array),
    );
  });

  it("routes to the stopped conversation once the abandoned answer lands", async () => {
    let resolveAsk: (value: ActionResult<GroundedAnswerResponse>) => void = () => {};
    const askAction = vi.fn(
      () =>
        new Promise<ActionResult<GroundedAnswerResponse>>((resolve) => {
          resolveAsk = resolve;
        }),
    );
    const cancelAction = vi.fn(async () =>
      actionSuccess({ conversationId: "conversation-cancelled" }),
    );
    const onNavigate = vi.fn();
    const { result } = renderHook(() =>
      useChatTurn({ askAction, cancelAction, onNavigate }),
    );
    act(() => {
      void result.current.submit("question");
    });
    await act(async () => {
      await result.current.stop();
    });
    expect(onNavigate).not.toHaveBeenCalled();
    await act(async () => {
      resolveAsk({
        ok: false,
        error: { code: "CANCELLED", message: "Stopped.", retryable: false },
      });
    });
    expect(onNavigate).toHaveBeenCalledWith("conversation-cancelled");
    // The late result must not add a second turn to the stopped conversation.
    expect(result.current.turns).toHaveLength(1);
  });

  it("starts from server-loaded turns and conversation id", async () => {
    const askAction = vi.fn(async () => actionSuccess({ ...answer, conversationId: undefined }));
    const { result } = renderHook(() =>
      useChatTurn({
        askAction,
        initialConversationId: "loaded",
        initialTurns: [{ id: "turn_0", question: "earlier", answer: null, error: null }],
      }),
    );
    expect(result.current.turns).toHaveLength(1);
    await act(async () => {
      await result.current.submit("next");
    });
    expect(askAction).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "loaded" }),
    );
    expect(result.current.conversationId).toBe("loaded");
  });

  it("reset clears the transcript and starts a fresh conversation", async () => {
    const askAction = vi.fn<AskAction>(async () => actionSuccess(answer));
    const { result } = renderHook(() => useChatTurn({ askAction }));
    await act(async () => {
      await result.current.submit("question");
    });
    act(() => result.current.reset());
    expect(result.current.turns).toEqual([]);
    expect(result.current.conversationId).toBeNull();
    await act(async () => {
      await result.current.submit("again");
    });
    expect(askAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ conversationId: null }),
    );
  });
});

describe("useChatTurn document scope", () => {
  it("sends scopeDocumentId on the first turn only", async () => {
    const askAction = vi.fn<AskAction>(async () => actionSuccess(answer));
    const { result } = renderHook(() =>
      useChatTurn({ askAction, scopeDocumentId: "doc-9", getAssumedPrincipal: () => null }),
    );
    await act(async () => {
      await result.current.submit("first");
    });
    expect(askAction.mock.calls[0][0]).toMatchObject({ conversationId: null, scopeDocumentId: "doc-9" });
    await act(async () => {
      await result.current.submit("second");
    });
    expect(askAction.mock.calls[1][0]).toMatchObject({ conversationId: "conversation-1" });
    expect(askAction.mock.calls[1][0]).not.toHaveProperty("scopeDocumentId");
  });
});

describe("useChatTurn progress union", () => {
  it("starts at searching with the asker's readable count", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const { result } = renderHook(() =>
      useChatTurn({ askAction: vi.fn(never), readableDocuments: 34 }),
    );
    act(() => {
      void result.current.submit("question");
    });
    expect(result.current.progress).toEqual({ kind: "searching", readableDocuments: 34 });
  });

  it("follows searching, reading and writing with their counts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(progressResponse("searching", { readableDocuments: 30 }))
      .mockResolvedValueOnce(progressResponse("reading", { passages: 8 }))
      .mockResolvedValue(progressResponse("writing"));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    const { result } = renderHook(() => useChatTurn({ askAction: vi.fn(never) }));
    act(() => {
      void result.current.submit("question");
    });
    await act(async () => {});
    expect(result.current.progress).toEqual({ kind: "searching", readableDocuments: 30 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.progress).toEqual({ kind: "reading", passages: 8 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.progress).toEqual({ kind: "writing" });
  });

  it("ignores a counted stage that arrives without a valid count", async () => {
    const fetchMock = vi.fn(async () => progressResponse("reading", { passages: -3 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useChatTurn({ askAction: vi.fn(never), readableDocuments: 5 }),
    );
    act(() => {
      void result.current.submit("question");
    });
    await act(async () => {});
    expect(result.current.progress).toEqual({ kind: "searching", readableDocuments: 5 });
  });

  it("does not poll a view-as turn and sends the person's id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const askAction = vi.fn<AskAction>(async () => actionSuccess(answer));
    const { result } = renderHook(() => useChatTurn({ askAction, assumePrincipalId: "priya" }));
    await act(async () => {
      await result.current.submit("question");
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(askAction).toHaveBeenCalledWith(expect.objectContaining({ assumePrincipalId: "priya" }));
  });
});

describe("useChatTurn retry", () => {
  const failed = { id: "m-failed", question: "Q", answer: null, error: "x", errorRetryable: true };

  it("re-runs a stored failed turn through retryOfMessageId and takes its place", async () => {
    const askAction = vi.fn<AskAction>(async () => actionSuccess(answer));
    const { result } = renderHook(() =>
      useChatTurn({
        askAction,
        initialTurns: [{ id: "m-ok", question: "first", answer, error: null }, failed],
        initialConversationId: "c1",
      }),
    );
    await act(async () => {
      await result.current.retryTurn("m-failed");
    });
    expect(askAction).toHaveBeenCalledWith(
      expect.objectContaining({ retryOfMessageId: "m-failed", conversationId: "c1" }),
    );
    expect(result.current.turns.map((turn) => turn.question)).toEqual(["first", "Q"]);
    expect(result.current.turns[1].answer).not.toBeNull();
  });

  it("finds the failed message of a live failure by reading the conversation back", async () => {
    const askAction = vi
      .fn()
      .mockResolvedValueOnce(actionSuccess(answer))
      .mockResolvedValueOnce({ ok: false, error: { code: "INTERNAL_ERROR", message: "x", retryable: true } })
      .mockResolvedValueOnce(actionSuccess(answer));
    const loadConversation = vi.fn(async () =>
      actionSuccess({
        id: "conversation-1",
        title: "t",
        createdAt: 0,
        updatedAt: 0,
        turns: [
          { id: "m-failed-live", question: "second", answer: null, error: "x", answerType: null, latencyMs: null, passagesRetrieved: null, feedback: null, documentRequested: false },
        ],
      }),
    );
    const { result } = renderHook(() => useChatTurn({ askAction, loadConversation }));
    await act(async () => {
      await result.current.submit("first");
    });
    await act(async () => {
      await result.current.submit("second");
    });
    const failedTurn = result.current.turns[1];
    expect(failedTurn.answer).toBeNull();
    await act(async () => {
      await result.current.retryTurn(failedTurn.id);
    });
    expect(askAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ retryOfMessageId: "m-failed-live" }),
    );
    expect(result.current.turns).toHaveLength(2);
    expect(result.current.turns[1].answer).not.toBeNull();
  });

  it("asks the saved question again when Brain never stored the failure", async () => {
    const askAction = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { code: "INTERNAL_ERROR", message: "x", retryable: true } })
      .mockResolvedValueOnce(actionSuccess(answer));
    const { result } = renderHook(() => useChatTurn({ askAction }));
    await act(async () => {
      await result.current.submit("question");
    });
    await act(async () => {
      await result.current.retryTurn(result.current.turns[0].id);
    });
    const second = askAction.mock.calls[1][0] as Record<string, unknown>;
    expect(second).not.toHaveProperty("retryOfMessageId");
    expect(second.question).toBe("question");
    expect(result.current.turns).toHaveLength(1);
  });

  it("asks an answered turn again as a new turn, never through retryOfMessageId", async () => {
    const askAction = vi.fn<AskAction>(async () => actionSuccess(answer));
    const { result } = renderHook(() => useChatTurn({ askAction }));
    await act(async () => {
      await result.current.submit("question");
    });
    await act(async () => {
      await result.current.retryTurn(result.current.turns[0].id);
    });
    expect(askAction.mock.calls[1][0]).not.toHaveProperty("retryOfMessageId");
    expect(result.current.turns).toHaveLength(2);
  });

  it("hides the failed turn while its retry runs", async () => {
    let resolve: ((value: ActionResult<GroundedAnswerResponse>) => void) | undefined;
    const askAction = vi.fn(
      () => new Promise<ActionResult<GroundedAnswerResponse>>((r) => { resolve = r; }),
    );
    const { result } = renderHook(() =>
      useChatTurn({ askAction, initialTurns: [failed], initialConversationId: "c1" }),
    );
    act(() => {
      void result.current.retryTurn("m-failed");
    });
    await act(async () => {});
    expect(result.current.retryingTurnId).toBe("m-failed");
    await act(async () => {
      resolve?.(actionSuccess(answer));
    });
    expect(result.current.retryingTurnId).toBeNull();
  });
});

describe("useChatTurn stored extras", () => {
  it("merges stored latency, passages and catalog titles into a finished turn", async () => {
    const withMessage = { ...answer, assistantMessageId: "m1" };
    const askAction = vi.fn<AskAction>(async () => actionSuccess(withMessage));
    const loadConversation = vi.fn(async () =>
      actionSuccess({
        id: "conversation-1",
        title: "t",
        createdAt: 0,
        updatedAt: 0,
        turns: [
          {
            id: "m1",
            question: "q",
            error: null,
            answerType: "grounded" as const,
            latencyMs: 2100,
            passagesRetrieved: 8,
            feedback: null,
            documentRequested: false,
            answer: {
              ...withMessage,
              retrieval: {
                ...withMessage.retrieval,
                results: [{ rank: 1, score: 1, chunkId: "c", source: "s", section: "x", text: "t", tokenEstimate: 1, citationLabel: "[1]", documentTitle: "Parental Leave Policy" }],
              },
            },
          },
        ],
      }),
    );
    const { result } = renderHook(() => useChatTurn({ askAction, loadConversation }));
    await act(async () => {
      await result.current.submit("q");
    });
    await act(async () => {});
    expect(loadConversation).toHaveBeenCalledWith("conversation-1");
    expect(result.current.turns[0].latencyMs).toBe(2100);
    expect(result.current.turns[0].passagesRetrieved).toBe(8);
    expect(JSON.stringify(result.current.turns[0].answer?.retrieval.results)).toContain("Parental Leave Policy");
  });

  it("keeps the live answer when the stored read fails", async () => {
    const askAction = vi.fn<AskAction>(async () =>
      actionSuccess({ ...answer, assistantMessageId: "m1" }),
    );
    const loadConversation = vi.fn(async () => {
      throw new Error("offline");
    });
    const { result } = renderHook(() => useChatTurn({ askAction, loadConversation }));
    await act(async () => {
      await result.current.submit("q");
    });
    await act(async () => {});
    expect(result.current.turns[0].answer).not.toBeNull();
    expect(result.current.turns[0].latencyMs).toBeUndefined();
  });
});
