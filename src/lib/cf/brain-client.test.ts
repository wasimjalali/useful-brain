import { beforeEach, describe, expect, it, vi } from "vitest";

const brainFetch = vi.fn();

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: { BRAIN: { fetch: brainFetch } } }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

describe("brainJson error mapping", () => {
  beforeEach(() => {
    brainFetch.mockReset();
  });

  it("maps a Brain NOT_FOUND body to a non-retryable NOT_FOUND AppError", async () => {
    brainFetch.mockResolvedValue(
      Response.json(
        { code: "NOT_FOUND", message: "That resource was not found.", retryable: false },
        { status: 404 },
      ),
    );
    const { brainJson } = await import("./brain-client");
    await expect(brainJson("/documents/x")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "That resource was not found.",
      retryable: false,
    });
  });

  it("carries the stored turn of a failed persisted turn into the action result", async () => {
    brainFetch.mockResolvedValue(
      Response.json(
        {
          code: "UNAVAILABLE",
          message: "The knowledge base is unavailable. Try the question again in a new turn.",
          retryable: true,
          requestId: "r-1",
          turn: { conversationId: "c-1", assistantMessageId: "m-2", extra: "dropped" },
        },
        { status: 503 },
      ),
    );
    const { brainJson } = await import("./brain-client");
    const { actionFailure } = await import("@/lib/rag/app-errors");
    const caught = await brainJson("/turns").catch((error: unknown) => error);
    expect(actionFailure(caught)).toEqual({
      ok: false,
      error: {
        code: "PROVIDER_TEMPORARY",
        message: "The knowledge base is unavailable. Try the question again in a new turn.",
        retryable: true,
        turn: { conversationId: "c-1", assistantMessageId: "m-2" },
      },
    });
  });

  it("drops a malformed turn reference instead of passing it on", async () => {
    for (const turn of [
      { conversationId: "c-1" },
      { conversationId: 7, assistantMessageId: "m-2" },
      { conversationId: "c-1", assistantMessageId: "x".repeat(201) },
      "c-1",
    ]) {
      brainFetch.mockResolvedValue(
        Response.json({ code: "UNAVAILABLE", message: "down", retryable: true, turn }, { status: 503 }),
      );
      const { brainJson } = await import("./brain-client");
      const caught = await brainJson("/turns").catch((error: unknown) => error);
      expect(caught).not.toHaveProperty("turn");
    }
  });
});
