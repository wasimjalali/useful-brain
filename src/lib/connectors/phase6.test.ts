import { describe, expect, it } from "vitest";

import { IdempotentExecutor, MemoryIdempotencyStore, approvalFromAttempt, mutatingIdempotencyKey } from "../agent/approvals";
import { argumentFingerprint, toolPolicy } from "../agent/policy";
import { startSyntheticMcp, toolText } from "./mcp-session";
import { ConnectorRegistryError, seedSyntheticConnectors } from "./registry";
import {
  ActionSink,
  UNTRUSTED_CONNECTOR_PREFIX,
  createActionSinkTool,
  createHttpReadTool,
  createMcpCreateTicketTool,
  createMcpLookupTool,
  createPluginEchoTool,
} from "./tools";

const principal = { id: "principal-alice" };

describe("connector registry", () => {
  it("registers metadata and refuses revoked or over-limit connectors", () => {
    const registry = seedSyntheticConnectors();
    const http = registry.get("http-docs");
    expect(http.capability).toBe("read");
    expect(http.auth).toBe("none");
    expect(http.rateLimitPerMinute).toBe(30);
    expect(http.dataClassification).toBe("internal");
    expect(http.health).toBe("healthy");
    const tight = seedSyntheticConnectors();
    tight.get("plugin-echo").rateLimitPerMinute = 1;
    tight.assertUsable("plugin-echo", "plugin.echo", 1_000);
    expect(() => tight.assertUsable("plugin-echo", "plugin.echo", 1_001)).toThrow(/rate limit/);
    registry.revoke("http-docs");
    expect(() => registry.assertUsable("http-docs", "http.read")).toThrow(ConnectorRegistryError);
  });
});

describe("Phase 6 connectors, MCP and plugins", () => {
  it("reads allowlisted HTTP through the policy gateway and frames results as untrusted", async () => {
    const registry = seedSyntheticConnectors();
    const tool = createHttpReadTool({
      registry,
      principal,
      conversationId: "c-1",
      fetchImpl: async () => new Response("# Returns\nOpened products may be returned.", { status: 200 }),
    });
    const result = await tool.execute("t1", { url: "https://docs.example.com/returns.md" });
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text.startsWith(UNTRUSTED_CONNECTOR_PREFIX)).toBe(true);
      expect(result.content[0].text).toContain("Opened products may be returned.");
    }
  });

  it("aborts a hung allowlisted HTTP read through the agent abort signal", async () => {
    const registry = seedSyntheticConnectors();
    const tool = createHttpReadTool({
      registry,
      principal,
      conversationId: "c-1",
      fetchImpl: (_url, init) =>
        new Promise((_, reject) => {
          const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
          if (init?.signal?.aborted) {
            abort();
            return;
          }
          init?.signal?.addEventListener("abort", abort, { once: true });
        }),
    });
    const result = await tool.execute(
      "t1",
      { url: "https://docs.example.com/returns.md" },
      AbortSignal.timeout(20),
    );
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("aborted");
    }
  }, 1000);

  it("does not follow off-allowlist HTTP and records the failure as untrusted data", async () => {
    const registry = seedSyntheticConnectors();
    const tool = createHttpReadTool({
      registry,
      principal,
      conversationId: "c-1",
      fetchImpl: async () => new Response("secret", { status: 200 }),
    });
    const result = await tool.execute("t1", { url: "https://evil.example/secret.md" });
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("not allowlisted");
    }
  });

  it("cancels an HTTP response that exceeds the raw external byte budget", async () => {
    const registry = seedSyntheticConnectors();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const tool = createHttpReadTool({
      registry,
      principal,
      conversationId: "c-1",
      fetchImpl: async () => new Response(stream, { status: 200 }),
    });
    const result = await tool.execute("t1", { url: "https://docs.example.com/large.md" });
    expect(cancelled).toBe(true);
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("exceeds");
    }
  });

  it("looks up a ticket through the in-process MCP server", async () => {
    const registry = seedSyntheticConnectors();
    const session = await startSyntheticMcp();
    try {
      const listed = await session.client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(["northwind_lookup", "create_ticket"]);
      const tool = createMcpLookupTool({
        registry,
        principal,
        conversationId: "c-1",
        client: session.client,
      });
      const result = await tool.execute("t1", { ticketId: "t-100" });
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("UNTRUSTED_MCP_RESULT");
        expect(result.content[0].text).toContain("Northwind returns printer");
      }
    } finally {
      await session.close();
    }
  });

  it("forwards the read-tool abort signal into MCP callTool", async () => {
    const registry = seedSyntheticConnectors();
    let forwarded: AbortSignal | undefined;
    const client = {
      async callTool(
        _params: unknown,
        _schema?: unknown,
        options?: { signal?: AbortSignal },
      ) {
        forwarded = options?.signal;
        return new Promise((_, reject) => {
          const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
          if (options?.signal?.aborted) {
            abort();
            return;
          }
          options?.signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };
    const tool = createMcpLookupTool({
      registry,
      principal,
      conversationId: "c-1",
      client: client as never,
    });
    const result = await tool.execute("t1", { ticketId: "t-100" }, AbortSignal.timeout(20));
    expect(forwarded).toBeDefined();
    expect(forwarded?.aborted).toBe(true);
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("aborted");
    }
  }, 1000);

  it("rejects an MCP result beyond the raw external byte budget", () => {
    expect(() =>
      toolText(
        { content: [{ type: "text", text: "x".repeat(1025) }] },
        1024,
      ),
    ).toThrow(/exceeds 1024 bytes/);
  });

  it("requires approval before an MCP write and is idempotent after approval", async () => {
    const registry = seedSyntheticConnectors();
    const session = await startSyntheticMcp();
    const executor = new IdempotentExecutor(new MemoryIdempotencyStore());
    try {
      const blocked = createMcpCreateTicketTool({
        registry,
        principal,
        conversationId: "c-1",
        client: session.client,
        executor,
      });
      const pending = await blocked.execute("t1", { title: "alpha" });
      expect(pending.details.pendingApproval).toBe(true);
      expect(session.tickets).toHaveLength(1);

      const approval = approvalFromAttempt({
        principalId: principal.id,
        conversationId: "c-1",
        tool: "mcp_create_ticket",
        args: { title: "alpha" },
        idempotencyKey: await mutatingIdempotencyKey(
          "mcp_create_ticket",
          { title: "alpha" },
          "principal-alice-c-1-t1",
        ),
        expiresAt: Date.now() + 60_000,
      });
      const allowed = createMcpCreateTicketTool({
        registry,
        principal,
        conversationId: "c-1",
        client: session.client,
        executor,
        approval,
      });
      await allowed.execute("t1", { title: "alpha" });
      await allowed.execute("t1", { title: "alpha" });
      expect(session.tickets.filter((ticket) => ticket.title === "alpha")).toHaveLength(1);
    } finally {
      await session.close();
    }
  });

  it("proves the synthetic action sink: preview, binding, idempotency, audit, revocation, retry", async () => {
    const registry = seedSyntheticConnectors();
    const sink = new ActionSink();
    const executor = new IdempotentExecutor(new MemoryIdempotencyStore());
    const preview = sink.preview("alpha");
    expect(preview.args).toEqual({ title: "alpha" });
    expect(argumentFingerprint(preview.args)).toBe(argumentFingerprint({ title: "alpha" }));

    const pendingTool = createActionSinkTool({
      registry,
      principal,
      conversationId: "c-1",
      sink,
      executor,
    });
    const pending = await pendingTool.execute("t1", { title: "alpha" });
    expect(pending.details.pendingApproval).toBe(true);
    expect(sink.writes).toEqual([]);

    const approval = approvalFromAttempt({
      principalId: principal.id,
      conversationId: "c-1",
      tool: "action_sink_write",
      args: preview.args,
      idempotencyKey: await mutatingIdempotencyKey(
        "action_sink_write",
        { title: "alpha" },
        "principal-alice-c-1-t1",
      ),
      expiresAt: Date.now() + 60_000,
    });
    const allowed = createActionSinkTool({
      registry,
      principal,
      conversationId: "c-1",
      sink,
      executor,
      approval,
    });
    await allowed.execute("t1", { title: "alpha" });
    await allowed.execute("t1", { title: "alpha" });
    expect(sink.writes).toEqual([{
      key: await mutatingIdempotencyKey(
        "action_sink_write",
        { title: "alpha" },
        "principal-alice-c-1-t1",
      ),
      title: "alpha",
    }]);
    expect(registry.audit.some((event) => event.action === "call" && event.connectorId === "action-sink")).toBe(
      true,
    );

    registry.revoke("action-sink");
    const denied = createActionSinkTool({
      registry,
      principal,
      conversationId: "c-1",
      sink,
      executor,
      approval: approvalFromAttempt({
        principalId: principal.id,
        conversationId: "c-1",
        tool: "action_sink_write",
        args: { title: "beta" },
        idempotencyKey: await mutatingIdempotencyKey(
          "action_sink_write",
          { title: "beta" },
          "principal-alice-c-1-t5",
        ),
        expiresAt: Date.now() + 60_000,
      }),
    });
    const revoked = await denied.execute("t5", { title: "beta" });
    if (revoked.content[0]?.type === "text") {
      expect(revoked.content[0].text).toContain("revoked");
    }
    expect(sink.writes).toHaveLength(1);
  });

  it("runs a local plugin through the same gateway", async () => {
    const registry = seedSyntheticConnectors();
    const tool = createPluginEchoTool({ registry, principal, conversationId: "c-1" });
    const result = await tool.execute("t1", { text: "hello" });
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain(UNTRUSTED_CONNECTOR_PREFIX);
      expect(result.content[0].text).toContain("hello");
    }
    expect(toolPolicy("plugin_echo").risk).toBe("read");
    expect(toolPolicy("mcp_create_ticket").executionMode).toBe("sequential");
    expect(toolPolicy("action_sink_write").executionMode).toBe("sequential");
  });
});
