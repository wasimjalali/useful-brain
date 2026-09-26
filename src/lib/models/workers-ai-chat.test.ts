import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";

import {
  contextToWorkersAiMessages,
  createWorkersAiChatStream,
  parseWorkersAiChatMessage,
} from "./workers-ai-chat";
import { glm53FlashModel } from "./glm-5-3-flash";
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

  it("pins temperature 0 on every chat call for run-to-run comparability", async () => {
    const inputs: Array<Record<string, unknown>> = [];
    const stream = createWorkersAiChatStream({
      run: async (_model, input) => {
        inputs.push(input);
        return { choices: [{ finish_reason: "stop", message: { content: "ok" } }] };
      },
    });
    const message = await stream(glm53FlashModel(), {
      systemPrompt: "Ground every answer.",
      messages: [{ role: "user", content: "What is the refund window?", timestamp: 1 }],
      tools: [],
    }).result();
    expect(message.stopReason).toBe("stop");
    expect(inputs[0]?.temperature).toBe(0);
    expect(inputs[0]?.seed).toBe(7);
  });

  it("forwards the caller's abort signal into the ai.run options", async () => {
    const controller = new AbortController();
    const seen: Array<{ signal?: AbortSignal } | undefined> = [];
    const stream = createWorkersAiChatStream({
      run: async (_model, _input, options) => {
        seen.push(options);
        return { choices: [{ finish_reason: "stop", message: { content: "ok" } }] };
      },
    });
    const message = await stream(
      glm53FlashModel(),
      {
        systemPrompt: "Ground every answer.",
        messages: [{ role: "user", content: "What is the refund window?", timestamp: 1 }],
        tools: [],
      },
      { signal: controller.signal },
    ).result();
    expect(message.stopReason).toBe("stop");
    expect(seen[0]?.signal).toBe(controller.signal);
  });

  it("ends the stream aborted when the signal fires mid-call and discards the late result", async () => {
    const controller = new AbortController();
    let releaseRun!: () => void;
    const stream = createWorkersAiChatStream({
      run: () =>
        new Promise((resolve) => {
          releaseRun = () =>
            resolve({ choices: [{ finish_reason: "stop", message: { content: "late" } }] });
        }),
    });
    const eventStream = stream(
      glm53FlashModel(),
      {
        systemPrompt: "Ground every answer.",
        messages: [{ role: "user", content: "What is the refund window?", timestamp: 1 }],
        tools: [],
      },
      { signal: controller.signal },
    );
    controller.abort();
    releaseRun();
    const message = await eventStream.result();
    expect(message.stopReason).toBe("aborted");
  });

  it("never calls the model when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn();
    const stream = createWorkersAiChatStream({ run });
    const message = await stream(
      glm53FlashModel(),
      {
        systemPrompt: "Ground every answer.",
        messages: [{ role: "user", content: "What is the refund window?", timestamp: 1 }],
        tools: [],
      },
      { signal: controller.signal },
    ).result();
    expect(message.stopReason).toBe("aborted");
    expect(run).not.toHaveBeenCalled();
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
