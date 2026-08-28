import { describe, expect, it } from "vitest";

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
});
