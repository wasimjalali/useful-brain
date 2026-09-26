import { describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS } from "./instructions";
import { embedWithWorkersAi, parseEmbeddingVectors } from "./workers-ai-embed";

function vector(fill: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => fill);
}

describe("Workers AI embedding parser", () => {
  it("reads OpenAI-shaped data[].embedding arrays", () => {
    const parsed = parseEmbeddingVectors(
      { data: [{ embedding: vector(0.1) }, { embedding: vector(0.2) }] },
      2,
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(parsed[1][0]).toBe(0.2);
  });

  it("reads result.data nested vectors", () => {
    const parsed = parseEmbeddingVectors({ result: { data: [vector(0.3)] } }, 1);
    expect(parsed[0][0]).toBe(0.3);
  });

  it("fails closed on the wrong count or width", () => {
    expect(() => parseEmbeddingVectors({ data: [{ embedding: vector(1) }] }, 2)).toThrow(
      /returned 1 vectors for 2/,
    );
    expect(() => parseEmbeddingVectors({ data: [{ embedding: [1, 2, 3] }] }, 1)).toThrow(
      /does not match 1024/,
    );
  });
});

describe("embedWithWorkersAi cancellation", () => {
  it("forwards the abort signal into the ai.run options", async () => {
    const controller = new AbortController();
    const seen: Array<{ signal?: AbortSignal } | undefined> = [];
    const run = vi.fn().mockImplementation(async (_model, _input, options) => {
      seen.push(options);
      return { data: [vector(0.5)] };
    });

    await expect(
      embedWithWorkersAi({ run }, "embed-model", { kind: "query", text: "refund" }, controller.signal),
    ).resolves.toHaveLength(1);
    expect(seen[0]?.signal).toBe(controller.signal);
  });

  it("rejects without calling the model when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn();

    await expect(
      embedWithWorkersAi({ run }, "embed-model", { kind: "query", text: "refund" }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects and discards the result when the signal aborts during the call", async () => {
    const controller = new AbortController();
    const run = vi.fn().mockImplementation(async () => {
      controller.abort();
      return { data: [vector(0.5)] };
    });

    await expect(
      embedWithWorkersAi({ run }, "embed-model", { kind: "query", text: "refund" }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
