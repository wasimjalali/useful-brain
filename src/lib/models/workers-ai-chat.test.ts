import { Type } from "typebox";
import { describe, expect, it } from "vitest";

import { contextToWorkersAiMessages, parseWorkersAiChatMessage } from "./workers-ai-chat";
import { CHAT_MODEL_ID } from "./selection";

describe("Workers AI chat mapping", () => {
  it("maps system, user, assistant tool calls, and tool results", () => {
    const messages = contextToWorkersAiMessages({
      systemPrompt: "Ground every answer.",
      messages: [
        { role: "user", content: "What is the refund window?", timestamp: 1 },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Searching." },
            { type: "toolCall", id: "call-1", name: "search_knowledge", arguments: { query: "refund" } },
          ],
          api: "openai-completions",
          provider: "cloudflare-workers-ai",
          model: CHAT_MODEL_ID,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "toolUse",
          timestamp: 2,
        },
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "search_knowledge",
          content: [{ type: "text", text: "UNTRUSTED_EVIDENCE\n{}" }],
          isError: false,
          timestamp: 3,
        },
      ],
      tools: [
        {
          name: "search_knowledge",
          description: "Search",
          parameters: Type.Object({ query: Type.String() }),
        },
      ],
    });
    expect(messages[0]).toEqual({ role: "system", content: "Ground every answer." });
    expect(messages[1]).toEqual({ role: "user", content: "What is the refund window?" });
    expect(messages[2]?.tool_calls?.[0]?.function.name).toBe("search_knowledge");
    expect(messages[3]).toMatchObject({ role: "tool", tool_call_id: "call-1" });
  });

  it("parses tool_calls finish reason", () => {
    const message = parseWorkersAiChatMessage(
      {
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                {
                  id: "call-9",
                  function: { name: "search_knowledge", arguments: "{\"query\":\"leave\"}" },
                },
              ],
            },
          },
        ],
      },
      CHAT_MODEL_ID,
    );
    expect(message.stopReason).toBe("toolUse");
    expect(message.content[0]).toMatchObject({
      type: "toolCall",
      id: "call-9",
      name: "search_knowledge",
      arguments: { query: "leave" },
    });
  });
});
