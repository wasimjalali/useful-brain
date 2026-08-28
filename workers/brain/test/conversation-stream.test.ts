import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("conversation stream fan-out and cancellation", () => {
  it("fans out a hibernatable event to two sockets after eviction", async () => {
    const stub = env.CONVERSATION.getByName("conv-stream");
    const first = await connect(stub);
    const second = await connect(stub);
    await evictDurableObject(stub);
    const firstMessage = nextMessage(first);
    const secondMessage = nextMessage(second);
    await stub.broadcast({ type: "completed", runId: "run-stream" });
    expect(await firstMessage).toBe(JSON.stringify({ type: "completed", runId: "run-stream" }));
    expect(await secondMessage).toBe(JSON.stringify({ type: "completed", runId: "run-stream" }));
    first.close();
    second.close();
  });

  it("cancels the owning run and does not leak transport detail", async () => {
    const stub = env.CONVERSATION.getByName("conv-cancel");
    const client = await connect(stub);
    expect(await stub.acquire("run-cancel")).toEqual({ ok: true, runId: "run-cancel" });
    expect(await stub.cancel("run-other")).toEqual({ ok: false, status: 409 });
    const cancelled = nextMessage(client);
    expect(await stub.cancel("run-cancel")).toEqual({ ok: true, runId: "run-cancel" });
    expect(await stub.cancelled()).toBe(true);
    expect(await cancelled).toBe(JSON.stringify({ type: "cancelled", runId: "run-cancel" }));
    expect(await stub.status()).toEqual({ runId: "run-cancel" });
    client.close();
  });
});

async function connect(stub: ReturnType<typeof env.CONVERSATION.getByName>): Promise<WebSocket> {
  const response = await stub.fetch("https://conversation/websocket", {
    headers: { Upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const client = response.webSocket;
  expect(client).toBeDefined();
  client!.accept();
  return client!;
}

function nextMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for websocket message")), 2000);
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timer);
        resolve(String(event.data));
      },
      { once: true },
    );
  });
}
