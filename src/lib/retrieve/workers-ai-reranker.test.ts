import { describe, expect, it, vi } from "vitest";

import { RERANKER_MODEL } from "./rerank";
import { WorkersAiReranker } from "./workers-ai-reranker";

describe("WorkersAiReranker", () => {
  it("returns an empty list for no passages", async () => {
    const reranker = new WorkersAiReranker({
      run: async () => {
        throw new Error("should not run");
      },
    });
    expect(await reranker.rerank("refund window", [])).toEqual([]);
  });

  it("sends the BGE model id and returns scores in passage order", async () => {
    const reranker = new WorkersAiReranker({
      run: async (model, input) => {
        expect(model).toBe(RERANKER_MODEL);
        expect(input.query).toBe("refund window");
        return {
          success: true,
          result: {
            response: [
              { id: 1, score: 0.2 },
              { id: 0, score: 0.9 },
            ],
          },
        };
      },
    });
    expect(await reranker.rerank("refund window", ["first", "second"])).toEqual([0.9, 0.2]);
  });

  it("accepts the direct Workers AI binding response", async () => {
    const reranker = new WorkersAiReranker({
      run: async () => ({
        response: [
          { id: 1, score: 0.02 },
          { id: 0, score: 0.98 },
        ],
      }),
    });

    expect(await reranker.rerank("refund window", ["refund policy", "parental leave"])).toEqual([
      0.98,
      0.02,
    ]);
  });

  it("forwards the abort signal into the ai.run options", async () => {
    const controller = new AbortController();
    const seen: Array<{ signal?: AbortSignal } | undefined> = [];
    const reranker = new WorkersAiReranker({
      run: async (_model, _input, options) => {
        seen.push(options);
        return { response: [{ id: 0, score: 0.9 }] };
      },
    });

    expect(await reranker.rerank("refund window", ["first"], controller.signal)).toEqual([0.9]);
    expect(seen[0]?.signal).toBe(controller.signal);
  });

  it("rejects without calling the model when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn();
    const reranker = new WorkersAiReranker({ run });

    await expect(
      reranker.rerank("refund window", ["first"], controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects and discards scores when the signal aborts during the call", async () => {
    const controller = new AbortController();
    const reranker = new WorkersAiReranker({
      run: async () => {
        controller.abort();
        return { response: [{ id: 0, score: 0.9 }] };
      },
    });

    await expect(
      reranker.rerank("refund window", ["first"], controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
