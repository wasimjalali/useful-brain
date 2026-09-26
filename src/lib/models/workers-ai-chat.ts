import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type StreamFunction,
  type ToolCall,
} from "@earendil-works/pi-ai";

import { CHAT_MODEL_PROVIDER } from "../models/selection";
import type { WorkersAiRunOptions } from "../embeddings/workers-ai-embed";

export class ChatModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatModelError";
  }
}

/**
 * Measured generation-cap candidate: every chat call is capped at 4000
 * completion tokens, matching AGENT_BUDGETS.maxOutputTokens. Bump the
 * policy version when the cap changes so eval runs can name the budget
 * policy that produced them. Extraction calls keep their own tighter cap
 * in workers-ai-citation-repair.ts.
 */
export const GENERATION_BUDGET_POLICY = "cap-4000-v1";
const GENERATION_MAX_COMPLETION_TOKENS = 4_000;

export type WorkersAiChatRunner = {
  run(
    model: string,
    input: Record<string, unknown>,
    options?: WorkersAiRunOptions,
  ): Promise<unknown>;
};

type OpenAiChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export function contextToWorkersAiMessages(context: Context): OpenAiChatMessage[] {
  const messages: OpenAiChatMessage[] = [];
  if (context.systemPrompt?.trim()) {
    messages.push({ role: "system", content: context.systemPrompt });
  }
  for (const message of context.messages) {
    messages.push(toOpenAiMessage(message));
  }
  return messages;
}

export function contextToWorkersAiTools(context: Context): Array<{
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}> {
  return (context.tools ?? []).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function parseWorkersAiChatMessage(payload: unknown, modelId: string): AssistantMessage {
  const choice = readChoice(payload);
  const message = choice.message ?? {};
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const content: AssistantMessage["content"] = [];
  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({ type: "text", text: message.content });
  }
  for (const call of toolCalls) {
    content.push(parseToolCall(call));
  }
  const usage = readUsage(payload);
  const finish = typeof choice.finish_reason === "string" ? choice.finish_reason : "stop";
  // A generation that exhausts the completion cap without emitting any
  // content is a bounded failure, not an answer: surfacing it as an error
  // stops the turn instead of grounding an empty draft.
  const emptyTruncation = finish === "length" && content.length === 0;
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: CHAT_MODEL_PROVIDER,
    model: modelId,
    usage: {
      input: usage.input,
      output: usage.output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: usage.totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: emptyTruncation
      ? "error"
      : finish === "tool_calls" || finish === "function_call"
        ? "toolUse"
        : finish === "length"
          ? "length"
          : "stop",
    ...(emptyTruncation
      ? { errorMessage: "chat model hit the completion token cap without returning content" }
      : {}),
    timestamp: Date.now(),
  };
}

export function createWorkersAiChatStream(ai: WorkersAiChatRunner): StreamFunction<"openai-completions"> {
  return (model: Model<"openai-completions">, context: Context, options?: SimpleStreamOptions) => {
    const stream = createAssistantMessageEventStream();
    void runChat(ai, model, context, options, stream).catch((error) => {
      const reason = options?.signal?.aborted ? ("aborted" as const) : ("error" as const);
      const failed: AssistantMessage = {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: CHAT_MODEL_PROVIDER,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: reason,
        errorMessage: error instanceof Error ? error.message : "chat model failed",
        timestamp: Date.now(),
      };
      stream.push({ type: "error", reason, error: failed });
      stream.end(failed);
    });
    return stream;
  };
}

async function runChat(
  ai: WorkersAiChatRunner,
  model: Model<"openai-completions">,
  context: Context,
  options: SimpleStreamOptions | undefined,
  stream: ReturnType<typeof createAssistantMessageEventStream>,
): Promise<void> {
  options?.signal?.throwIfAborted();
  const tools = contextToWorkersAiTools(context);
  const payload: Record<string, unknown> = {
    messages: contextToWorkersAiMessages(context),
    stream: false,
    // Deterministic decoding: answers must be comparable across eval runs.
    // The seed is best-effort per the Workers AI schema.
    temperature: 0,
    seed: 7,
    // Bounded completion spend per chat call (GENERATION_BUDGET_POLICY).
    max_completion_tokens: GENERATION_MAX_COMPLETION_TOKENS,
  };
  if (tools.length > 0) {
    payload.tools = tools;
  }
  const response = await ai.run(model.id, payload, { signal: options?.signal });
  options?.signal?.throwIfAborted();
  const message = parseWorkersAiChatMessage(response, model.id);
  if (message.stopReason === "error") {
    stream.push({ type: "error", reason: "error", error: message });
    stream.end(message);
    return;
  }
  const doneReason =
    message.stopReason === "toolUse" || message.stopReason === "length"
      ? message.stopReason
      : ("stop" as const);
  stream.push({ type: "start", partial: { ...message, content: [], stopReason: "pending" } });
  stream.push({ type: "done", reason: doneReason, message });
  stream.end(message);
}

function toOpenAiMessage(message: Message): OpenAiChatMessage {
  if (message.role === "user") {
    const content =
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    return { role: "user", content };
  }
  if (message.role === "toolResult") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
    };
  }
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  const toolCalls = message.content.filter((part): part is ToolCall => part.type === "toolCall");
  const mapped: OpenAiChatMessage = { role: "assistant", content: text };
  if (toolCalls.length > 0) {
    mapped.tool_calls = toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
    }));
  }
  return mapped;
}

function readUsage(payload: unknown): { input: number; output: number; totalTokens: number } {
  const body = isRecord(payload) ? payload : {};
  const envelope = isRecord(body.result) ? body.result : {};
  const usage = isRecord(body.usage) ? body.usage : isRecord(envelope.usage) ? envelope.usage : {};
  const input = usageNumber(usage, "prompt_tokens", "input_tokens");
  const output = usageNumber(usage, "completion_tokens", "output_tokens");
  return {
    input,
    output,
    totalTokens: usageNumber(usage, "total_tokens") || input + output,
  };
}

function usageNumber(usage: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readChoice(payload: unknown): {
  finish_reason?: string;
  message?: { content?: unknown; tool_calls?: unknown };
} {
  if (!payload || typeof payload !== "object") {
    throw new ChatModelError("chat response missing body");
  }
  const body = payload as {
    choices?: unknown;
    result?: { choices?: unknown; response?: unknown };
    response?: unknown;
  };
  const choices = Array.isArray(body.choices)
    ? body.choices
    : Array.isArray(body.result?.choices)
      ? body.result.choices
      : null;
  if (choices && choices[0] && typeof choices[0] === "object") {
    return choices[0] as { finish_reason?: string; message?: { content?: unknown; tool_calls?: unknown } };
  }
  const response = body.response ?? body.result?.response;
  if (typeof response === "string") {
    return { finish_reason: "stop", message: { content: response } };
  }
  throw new ChatModelError("chat response missing choices");
}

function parseToolCall(raw: unknown): ToolCall {
  if (!raw || typeof raw !== "object") {
    throw new ChatModelError("tool call is not an object");
  }
  const call = raw as {
    id?: unknown;
    function?: { name?: unknown; arguments?: unknown };
  };
  const id = typeof call.id === "string" && call.id ? call.id : "tool-1";
  const name = typeof call.function?.name === "string" ? call.function.name : "";
  if (!name) {
    throw new ChatModelError("tool call is missing a name");
  }
  let args: Record<string, unknown> = {};
  const rawArgs = call.function?.arguments;
  if (typeof rawArgs === "string" && rawArgs.trim()) {
    const parsed: unknown = JSON.parse(rawArgs);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>;
    }
  } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    args = rawArgs as Record<string, unknown>;
  }
  return { type: "toolCall", id, name, arguments: args };
}
