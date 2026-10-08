import { afterEach, describe, expect, it, vi } from "vitest";

import { brainJson } from "./live-northwind-eval";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("live Northwind harness availability", () => {
  it("stops loudly instead of scoring a turn the Brain reports unavailable", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () =>
      Response.json(
        {
          code: "UNAVAILABLE",
          message: "The knowledge base is unavailable. Try the question again in a new turn.",
          retryable: true,
        },
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const turn = brainJson("http://brain.test", "/turns", { method: "POST", body: "{}" });
    const outcome = expect(turn).rejects.toThrow(/unavailable \(503\).*not scored/);
    await vi.runAllTimersAsync();
    await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("returns the payload once a retried turn succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ code: "UNAVAILABLE" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ answer: "ok" }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const turn = brainJson<{ answer: string }>("http://brain.test", "/turns");
    await vi.runAllTimersAsync();
    await expect(turn).resolves.toEqual({ answer: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
