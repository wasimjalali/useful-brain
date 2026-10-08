import { afterEach, describe, expect, it, vi } from "vitest";

import { brainJson, liveTurn } from "./live-northwind-eval";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const unavailable = () =>
  Response.json(
    {
      code: "UNAVAILABLE",
      message: "The knowledge base is unavailable. Try the question again in a new turn.",
      retryable: true,
    },
    { status: 503 },
  );

/** Settle-tracking wrapper so a test can see whether a rejection already landed. */
function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; error?: unknown } = { settled: false };
  promise.then(
    () => {
      state.settled = true;
    },
    (error) => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
}

describe("live Northwind harness availability", () => {
  it("stops loudly on a turn the Brain keeps reporting unavailable, naming the question", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => unavailable());
    vi.stubGlobal("fetch", fetchMock);

    const state = track(liveTurn("http://brain.test", "q042", { method: "POST", body: "{}" }));
    // Backoff after attempts 1-3 only: 1s + 2s + 4s. No sleep follows the
    // final attempt, so the error lands without waiting another 8s.
    await vi.advanceTimersByTimeAsync(7_000);

    expect(state.settled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const message = (state.error as Error).message;
    expect(message).toMatch(/^q042: /);
    expect(message).toContain("statuses 503, 503, 503, 503");
    expect(message).toContain("the question was not scored");
  });

  it("reports every attempt's status and no scoring claim outside /turns", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 429 }))
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(Response.json({}, { status: 500 }))
      .mockResolvedValueOnce(unavailable());
    vi.stubGlobal("fetch", fetchMock);

    const state = track(brainJson("http://brain.test", "/knowledge"));
    await vi.advanceTimersByTimeAsync(7_000);

    expect(state.settled).toBe(true);
    const message = (state.error as Error).message;
    expect(message).toContain("statuses 429, 503, 500, 503");
    expect(message).not.toContain("not scored");
  });

  it("returns the payload once a retried turn succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(Response.json({ answer: "ok" }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const turn = brainJson<{ answer: string }>("http://brain.test", "/turns");
    await vi.runAllTimersAsync();
    await expect(turn).resolves.toEqual({ answer: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("names the question on a non-retryable Brain error too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ code: "CANCELLED", message: "The answer was stopped." }, { status: 409 })),
    );

    await expect(liveTurn("http://brain.test", "q007", { method: "POST", body: "{}" })).rejects.toThrow(
      "q007: The answer was stopped.",
    );
  });
});
