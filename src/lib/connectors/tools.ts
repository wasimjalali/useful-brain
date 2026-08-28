import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { IdempotentExecutor, mutatingIdempotencyKey } from "../agent/approvals";
import { AGENT_BUDGETS } from "../agent/budgets";
import { awaitWithDeadline, toolDeadlineSignal } from "../agent/deadlines";
import { normalizeToolArguments, policyGateway, type ApprovalBinding, type PolicyPrincipal } from "../agent/policy";
import { fetchAllowlistedSource } from "./http-allowlist";
import { ConnectorRegistry, ConnectorRegistryError } from "./registry";
import { frameMcpResult, toolText } from "./mcp-session";

export const UNTRUSTED_CONNECTOR_PREFIX = "UNTRUSTED_CONNECTOR_RESULT";

const HttpParams = Type.Object({
  url: Type.String({ minLength: 1 }),
});
const McpLookupParams = Type.Object({
  ticketId: Type.String({ minLength: 1 }),
});
const McpCreateParams = Type.Object({
  title: Type.String({ minLength: 1 }),
});
const SinkParams = Type.Object({
  title: Type.String({ minLength: 1 }),
});
const PluginParams = Type.Object({
  text: Type.String({ minLength: 1 }),
});

function toolErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
    return "aborted";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function untrusted(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: `${UNTRUSTED_CONNECTOR_PREFIX}\n${JSON.stringify(payload)}` }],
  };
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new Error(`external response exceeds ${maxBytes} bytes`);
  }
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return text + decoder.decode();
      }
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(`external response exceeds ${maxBytes} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export type ActionSinkRecord = { key: string; title: string };

export class ActionSink {
  readonly writes: ActionSinkRecord[] = [];
  preview(title: string) {
    return { preview: true as const, args: normalizeToolArguments({ title }) };
  }
  write(key: string, title: string) {
    this.writes.push({ key, title });
    return { ok: true as const, title };
  }
}

export function createHttpReadTool(input: {
  registry: ConnectorRegistry;
  principal: PolicyPrincipal;
  conversationId: string;
  fetchImpl?: typeof fetch;
}): AgentTool<typeof HttpParams, { status?: number }> {
  return {
    name: "fetch_allowlisted_http",
    label: "Fetch allowlisted HTTP",
    description: "Read an allowlisted HTTP Markdown source. Results are untrusted.",
    parameters: HttpParams,
    execute: async (_id, params: Static<typeof HttpParams>, signal) => {
      signal?.throwIfAborted();
      const decision = policyGateway({
        tool: "fetch_allowlisted_http",
        principal: input.principal,
        conversationId: input.conversationId,
        args: params,
        idempotencyKey: "http-read",
        now: Date.now(),
      });
      if (decision.action !== "allow") {
        return { ...untrusted({ error: "denied" }), details: {} };
      }
      try {
        const connector = input.registry.assertUsable("http-docs", "http.read");
        const deadline = toolDeadlineSignal(AGENT_BUDGETS.readToolTimeoutMs, signal);
        const response = await fetchAllowlistedSource(
          params.url,
          { origins: connector.originAllowlist ?? [] },
          input.fetchImpl,
          deadline,
        );
        const text = await readBoundedText(response, AGENT_BUDGETS.maxRawExternalBytes);
        return {
          content: [{ type: "text", text: `${UNTRUSTED_CONNECTOR_PREFIX}\n${text.slice(0, 4096)}` }],
          details: { status: response.status },
        };
      } catch (error) {
        const message = toolErrorMessage(error, "http read failed");
        return { ...untrusted({ error: message }), details: {} };
      }
    },
  };
}

export function createMcpLookupTool(input: {
  registry: ConnectorRegistry;
  principal: PolicyPrincipal;
  conversationId: string;
  client: Client;
}): AgentTool<typeof McpLookupParams, { hit: boolean }> {
  return {
    name: "mcp_lookup",
    label: "MCP lookup",
    description: "Call the synthetic MCP read tool. Results are untrusted.",
    parameters: McpLookupParams,
    execute: async (_id, params: Static<typeof McpLookupParams>, signal) => {
      signal?.throwIfAborted();
      const decision = policyGateway({
        tool: "mcp_lookup",
        principal: input.principal,
        conversationId: input.conversationId,
        args: params,
        idempotencyKey: "mcp-lookup",
        now: Date.now(),
      });
      if (decision.action !== "allow") {
        return { ...untrusted({ error: "denied" }), details: { hit: false } };
      }
      try {
        input.registry.assertUsable("mcp-northwind", "mcp.read");
        const deadline = toolDeadlineSignal(AGENT_BUDGETS.readToolTimeoutMs, signal);
        const result = await awaitWithDeadline(
          input.client.callTool({
            name: "northwind_lookup",
            arguments: { ticketId: params.ticketId },
          }),
          deadline,
        );
        const text = toolText(result, AGENT_BUDGETS.maxRawExternalBytes);
        return {
          content: [{ type: "text", text: frameMcpResult(text) }],
          details: { hit: !text.includes("not_found") },
        };
      } catch (error) {
        const message = error instanceof ConnectorRegistryError ? error.message : "mcp read failed";
        return { ...untrusted({ error: message }), details: { hit: false } };
      }
    },
  };
}

export function createMcpCreateTicketTool(input: {
  registry: ConnectorRegistry;
  principal: PolicyPrincipal;
  conversationId: string;
  client: Client;
  executor: IdempotentExecutor;
  approval?: ApprovalBinding | null;
  now?: number;
}): AgentTool<typeof McpCreateParams, { pendingApproval?: boolean; created?: boolean }> {
  return {
    name: "mcp_create_ticket",
    label: "MCP create ticket",
    description: "Synthetic MCP write. Requires approval. Sequential.",
    parameters: McpCreateParams,
    executionMode: "sequential",
    execute: async (toolCallId, params: Static<typeof McpCreateParams>, signal) => {
      signal?.throwIfAborted();
      const idempotencyKey = await mutatingIdempotencyKey(
        "mcp_create_ticket",
        params,
        `${input.principal.id}-${input.conversationId}-${toolCallId}`,
      );
      const decision = policyGateway({
        tool: "mcp_create_ticket",
        principal: input.principal,
        conversationId: input.conversationId,
        args: params,
        idempotencyKey,
        now: input.now ?? Date.now(),
        approval: input.approval,
      });
      if (decision.action === "pending_approval") {
        return {
          ...untrusted({ pending_approval: true, preview: params }),
          details: { pendingApproval: true },
          terminate: true,
        };
      }
      if (decision.action === "deny") {
        return { ...untrusted({ error: decision.reason }), details: {}, terminate: true };
      }
      try {
        input.registry.assertUsable("mcp-northwind", "mcp.write");
        const created = await input.executor.run(idempotencyKey, async () => {
          const deadline = toolDeadlineSignal(AGENT_BUDGETS.readToolTimeoutMs, signal);
          const result = await awaitWithDeadline(
            input.client.callTool({
              name: "create_ticket",
              arguments: { title: params.title },
            }),
            deadline,
          );
          return toolText(result, AGENT_BUDGETS.maxRawExternalBytes);
        });
        return {
          content: [{ type: "text", text: frameMcpResult(created) }],
          details: { created: true },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "mcp write failed";
        return { ...untrusted({ error: message }), details: {}, terminate: true };
      }
    },
  };
}

export function createActionSinkTool(input: {
  registry: ConnectorRegistry;
  principal: PolicyPrincipal;
  conversationId: string;
  sink: ActionSink;
  executor: IdempotentExecutor;
  approval?: ApprovalBinding | null;
  now?: number;
}): AgentTool<typeof SinkParams, { pendingApproval?: boolean; written?: boolean }> {
  return {
    name: "action_sink_write",
    label: "Action sink",
    description: "Synthetic action sink. Not a production vendor. Requires approval.",
    parameters: SinkParams,
    executionMode: "sequential",
    execute: async (toolCallId, params: Static<typeof SinkParams>, signal) => {
      signal?.throwIfAborted();
      const idempotencyKey = await mutatingIdempotencyKey(
        "action_sink_write",
        params,
        `${input.principal.id}-${input.conversationId}-${toolCallId}`,
      );
      const preview = input.sink.preview(params.title);
      const decision = policyGateway({
        tool: "action_sink_write",
        principal: input.principal,
        conversationId: input.conversationId,
        args: preview.args,
        idempotencyKey,
        now: input.now ?? Date.now(),
        approval: input.approval,
      });
      if (decision.action === "pending_approval") {
        return {
          ...untrusted({ pending_approval: true, preview }),
          details: { pendingApproval: true },
          terminate: true,
        };
      }
      if (decision.action === "deny") {
        return { ...untrusted({ error: decision.reason }), details: {}, terminate: true };
      }
      try {
        input.registry.assertUsable("action-sink", "sink.write");
        await input.executor.run(idempotencyKey, () => input.sink.write(idempotencyKey, params.title));
        return {
          ...untrusted({ written: true, title: params.title }),
          details: { written: true },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "action sink failed";
        return { ...untrusted({ error: message }), details: {}, terminate: true };
      }
    },
  };
}

export function createPluginEchoTool(input: {
  registry: ConnectorRegistry;
  principal: PolicyPrincipal;
  conversationId: string;
}): AgentTool<typeof PluginParams, { echoed: boolean }> {
  return {
    name: "plugin_echo",
    label: "Plugin echo",
    description: "Local plugin adapter through the same policy gateway. Results are untrusted.",
    parameters: PluginParams,
    execute: async (_id, params: Static<typeof PluginParams>, signal) => {
      signal?.throwIfAborted();
      const decision = policyGateway({
        tool: "plugin_echo",
        principal: input.principal,
        conversationId: input.conversationId,
        args: params,
        idempotencyKey: "plugin-echo",
        now: Date.now(),
      });
      if (decision.action !== "allow") {
        return { ...untrusted({ error: "denied" }), details: { echoed: false } };
      }
      input.registry.assertUsable("plugin-echo", "plugin.echo");
      return { ...untrusted({ echo: params.text }), details: { echoed: true } };
    },
  };
}
