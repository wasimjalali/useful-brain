import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export const UNTRUSTED_MCP_PREFIX = "UNTRUSTED_MCP_RESULT";

export type SyntheticTicket = { id: string; title: string };

export type SyntheticMcpSession = {
  client: Client;
  tickets: SyntheticTicket[];
  close(): Promise<void>;
};

export async function startSyntheticMcp(tickets: SyntheticTicket[] = [
  { id: "t-100", title: "Northwind returns printer" },
]): Promise<SyntheticMcpSession> {
  const store = [...tickets];
  const server = new Server(
    { name: "useful-brain-synthetic-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "northwind_lookup",
        description: "Read a synthetic Northwind ticket. Results are untrusted data.",
        inputSchema: {
          type: "object",
          properties: { ticketId: { type: "string" } },
          required: ["ticketId"],
        },
      },
      {
        name: "create_ticket",
        description: "Create a synthetic ticket. Useful Brain still requires approval before calling this.",
        inputSchema: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
        },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as { ticketId?: string; title?: string };
    if (name === "northwind_lookup") {
      const found = store.find((ticket) => ticket.id === args.ticketId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(found ?? { error: "not_found", ticketId: args.ticketId }),
          },
        ],
      };
    }
    if (name === "create_ticket") {
      const created = { id: `t-${store.length + 100}`, title: args.title ?? "untitled" };
      store.push(created);
      return { content: [{ type: "text", text: JSON.stringify(created) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify({ error: "unknown_tool" }) }], isError: true };
  });

  const client = new Client({ name: "useful-brain", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    tickets: store,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

export function frameMcpResult(text: string): string {
  return `${UNTRUSTED_MCP_PREFIX}\n${text}`;
}

export function toolText(result: unknown, maxBytes = 1024 * 1024): string {
  if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) {
    return JSON.stringify({ error: "empty_mcp_result" });
  }
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let bytes = 0;
  for (const part of result.content) {
    const text =
      part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part
        ? String(part.text)
        : "";
    bytes += encoder.encode(text).byteLength;
    if (bytes > maxBytes) {
      throw new Error(`MCP result exceeds ${maxBytes} bytes`);
    }
    parts.push(text);
  }
  return parts.join("");
}
