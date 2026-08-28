import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/rag/app-errors";

const brainJson = vi.fn();

vi.mock("@/lib/cf/brain-client", () => ({
  brainJson: (...args: unknown[]) => brainJson(...args),
}));

describe("runEvalsAction", () => {
  beforeEach(() => {
    brainJson.mockReset();
  });

  it("forwards a completed evaluation run from Brain", async () => {
    const payload = {
      ranAt: "2026-08-28T12:00:00.000Z",
      total: 10,
      passed: 8,
      results: [],
    };
    brainJson.mockResolvedValue(payload);
    const { runEvalsAction } = await import("./eval-actions");

    await expect(runEvalsAction()).resolves.toEqual({ ok: true, data: payload });
    expect(brainJson).toHaveBeenCalledWith("/evaluations/run", { method: "POST", json: {} });
  });

  it("serializes a Brain failure as a stable action error", async () => {
    brainJson.mockRejectedValue(
      new AppError("INTERNAL_ERROR", "The evaluation result could not be saved.", true),
    );
    const { runEvalsAction } = await import("./eval-actions");

    const result = await runEvalsAction();

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The evaluation result could not be saved.",
        retryable: true,
      },
    });
  });
});
