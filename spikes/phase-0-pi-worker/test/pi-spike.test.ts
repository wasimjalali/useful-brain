import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import worker from "../src";
import {
  createSpikeAgent,
  reconstructAgent,
  runSpikePrompt,
  runSpikeUntilAbort,
  snapshotState,
} from "../src/pi-run";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("Phase 0 unpaid Pi Worker spike", () => {
  it("streams text deltas and typed tool events from fauxProvider", async () => {
    const result = await runSpikePrompt("Increment and record.");

    expect(result.events.some((event) => event.type === "agent_start")).toBe(true);
    expect(
      result.events.some(
        (event) =>
          event.type === "message_update" && event.assistantEventType === "text_delta",
      ),
    ).toBe(true);
    expect(
      result.events.some(
        (event) =>
          event.type === "tool_execution_start" &&
          event.toolName === "increment_counter",
      ),
    ).toBe(true);
    expect(
      result.events.some(
        (event) =>
          event.type === "tool_execution_end" && event.toolName === "record_value",
      ),
    ).toBe(true);
    expect(result.events.some((event) => event.type === "agent_end")).toBe(true);
    expect(result.aborted).toBe(false);
  });

  it("runs mutating tools sequentially", async () => {
    const result = await runSpikePrompt("Increment and record.");
    const incrementEnd = result.toolTrace.find(
      (entry) => entry.tool === "increment_counter" && entry.phase === "end",
    );
    const recordStart = result.toolTrace.find(
      (entry) => entry.tool === "record_value" && entry.phase === "start",
    );

    expect(incrementEnd).toBeDefined();
    expect(recordStart).toBeDefined();
    expect(incrementEnd!.at).toBeLessThanOrEqual(recordStart!.at);
    expect(result.counter).toBe(1);
    expect(result.notes).toEqual(["after-increment"]);
  });

  it("cancels through Agent.abort after the first streamed update", async () => {
    const result = await runSpikeUntilAbort("Write a long answer.");

    expect(result.aborted).toBe(true);
    expect(
      result.events.some(
        (event) =>
          event.type === "message_update" && event.assistantEventType === "text_delta",
      ),
    ).toBe(true);
    expect(result.events.at(-1)?.type).toBe("agent_end");
  });

  it("reconstructs a fresh agent from durable messages", async () => {
    const first = createSpikeAgent();
    const firstEvents: string[] = [];
    first.agent.subscribe((event) => {
      firstEvents.push(event.type);
    });
    await first.agent.prompt("Increment and record.");
    await first.agent.waitForIdle();

    const snapshot = snapshotState(first.agent);
    const second = reconstructAgent(snapshot);

    expect(second.agent).not.toBe(first.agent);
    expect(second.agent.state.messages).toEqual(snapshot.messages);
    expect(firstEvents).toContain("agent_end");

    await second.agent.prompt("Confirm the stored transcript.");
    await second.agent.waitForIdle();
    expect(second.agent.state.messages.length).toBeGreaterThan(
      snapshot.messages.length,
    );
  });

  it("serves health and streamed run over the Worker fetch handler", async () => {
    const ctx = createExecutionContext();
    const health = await worker.fetch(
      new IncomingRequest("http://example.com/health"),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      ok: true,
      provider: "faux",
    });

    const integration = await exports.default.fetch(
      new Request("http://example.com/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Increment and record." }),
      }),
    );

    expect(integration.status).toBe(200);
    expect(integration.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
    const payload = JSON.parse(
      new TextDecoder().decode(await integration.arrayBuffer()).trim(),
    ) as {
      counter: number;
      aborted: boolean;
    };
    expect(payload.aborted).toBe(false);
    expect(payload.counter).toBe(1);
  });
});
