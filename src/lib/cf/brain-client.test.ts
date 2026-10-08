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
});
