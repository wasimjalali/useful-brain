import { describe, expect, it } from "vitest";

import { awaitWithDeadline, toolDeadlineSignal } from "./deadlines";

describe("tool deadlines", () => {
  it("aborts a hung promise at the read-tool timeout", async () => {
    const signal = toolDeadlineSignal(20);
    const hung = new Promise<string>(() => undefined);
    await expect(awaitWithDeadline(hung, signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("propagates an already aborted agent signal", async () => {
    const agent = new AbortController();
    agent.abort();
    await expect(
      awaitWithDeadline(new Promise(() => undefined), toolDeadlineSignal(10_000, agent.signal)),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
