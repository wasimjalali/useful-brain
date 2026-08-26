import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Conversation Durable Object lock", () => {
  it("allows only one run to hold the lock under concurrent acquire", async () => {
    const stub = env.CONVERSATION.getByName("conv-concurrent");
    const [first, second] = await Promise.all([stub.acquire("run-a"), stub.acquire("run-b")]);
    const outcomes = [first, second];
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
    expect(outcomes.filter((result) => !result.ok && result.status === 409)).toHaveLength(1);
  });

  it("releases only the owning run and survives eviction", async () => {
    const stub = env.CONVERSATION.getByName("conv-restart");
    expect(await stub.acquire("run-owner")).toEqual({ ok: true, runId: "run-owner" });
    await evictDurableObject(stub);
    expect(await stub.status()).toEqual({ runId: "run-owner" });
    expect(await stub.release("run-other")).toEqual({ ok: false, status: 409 });
    expect(await stub.release("run-owner")).toEqual({ ok: true, runId: "run-owner" });
    expect(await stub.status()).toEqual({ runId: null });
  });

  it("rejects an unbounded run id", async () => {
    const stub = env.CONVERSATION.getByName("conv-invalid");
    expect(await stub.acquire("../run")).toEqual({ ok: false, status: 400 });
  });
});
