import { describe, expect, it } from "vitest";

import { finalizeR2Object } from "./r2-finalize";

describe("R2 upload finalization", () => {
  it("streams a bounded object by key without accepting path traversal", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("RF-75"));
        controller.close();
      },
    });
    const finalized = await finalizeR2Object(
      {
        async get(key) {
          return { key, size: 5, body };
        },
      },
      "uploads/policy.md",
    );
    expect(finalized.byteSize).toBe(5);
    expect(finalized.digest).toMatch(/^[a-f0-9]{64}$/);
    await expect(finalizeR2Object({ async get() { return null; } }, "../secret")).rejects.toThrow(/invalid/);
  });
});
