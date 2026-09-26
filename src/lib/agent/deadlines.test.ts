import { describe, expect, it, vi } from "vitest";

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

  it("rejects when the caller aborts while work is in flight", async () => {
    const agent = new AbortController();
    const signal = toolDeadlineSignal(10_000, agent.signal);
    let release!: () => void;
    const inFlight = new Promise<string>((resolve) => {
      release = () => resolve("done");
    });
    const raced = awaitWithDeadline(inFlight, signal);
    agent.abort();
    await expect(raced).rejects.toMatchObject({ name: "AbortError" });
    release();
    await inFlight;
  });

  it("keeps its rejection when the inner promise resolves after the deadline", async () => {
    const signal = toolDeadlineSignal(5);
    let release!: (value: string) => void;
    const late = new Promise<string>((resolve) => {
      release = resolve;
    });
    const raced = awaitWithDeadline(late, signal);
    await expect(raced).rejects.toMatchObject({ name: "AbortError" });
    release("too late");
    await expect(late).resolves.toBe("too late");
    await expect(raced).rejects.toMatchObject({ name: "AbortError" });
  });

  it("removes its abort listener when the inner promise resolves", async () => {
    const signal = toolDeadlineSignal(10_000);
    const removeSpy = vi.spyOn(signal, "removeEventListener");
    await expect(awaitWithDeadline(Promise.resolve("ok"), signal)).resolves.toBe("ok");
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it("removes its abort listener when the inner promise rejects", async () => {
    const signal = toolDeadlineSignal(10_000);
    const removeSpy = vi.spyOn(signal, "removeEventListener");
    await expect(awaitWithDeadline(Promise.reject(new Error("boom")), signal)).rejects.toThrow(
      "boom",
    );
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it("removes its abort listener when the signal fires", async () => {
    const agent = new AbortController();
    const signal = toolDeadlineSignal(10_000, agent.signal);
    const removeSpy = vi.spyOn(signal, "removeEventListener");
    const raced = awaitWithDeadline(new Promise(() => undefined), signal);
    agent.abort();
    await expect(raced).rejects.toMatchObject({ name: "AbortError" });
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});
