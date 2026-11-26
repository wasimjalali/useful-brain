import type { Context, Message, Model, StreamFunction } from "@earendil-works/pi-ai";
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";

import { BRAIN_NOT_ENOUGH_EVIDENCE, SEARCH_KNOWLEDGE_TOOL } from "../agent/host-grounding";
import type { AgentRuntime } from "../agent/run";
import { glm53FlashModel } from "../models/glm-5-3-flash";
import { normalizeForEvidenceMatch } from "../answer/sentence-match";
import { matchDemoQuestion } from "./demo-script";

export const DEMO_MODEL_ID = "useful-brain-demo-script";

/** Paced like a fast hosted model, so the answer streams in instead of snapping in. */
const TOKENS_PER_SECOND = 60;
const SEARCH_DELAY_MS = 500;

type EvidenceHit = { label: string; content: string };

function textOf(message: Message): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

/** Messages of the current turn: the last user message and everything after it. */
function currentTurn(context: Context): { question: string; after: Message[] } {
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (message.role === "user") {
      return { question: textOf(message), after: context.messages.slice(index + 1) };
    }
  }
  return { question: "", after: [] };
}

/** Hits from this turn's search results, in the order search returned them. */
export function evidenceHits(messages: Message[]): EvidenceHit[] {
  const hits: EvidenceHit[] = [];
  for (const message of messages) {
    if (message.role !== "toolResult" || message.toolName !== SEARCH_KNOWLEDGE_TOOL) {
      continue;
    }
    const raw = textOf(message);
    const start = raw.indexOf("{");
    if (start < 0) {
      continue;
    }
    const payload = JSON.parse(raw.slice(start)) as { hits?: Array<{ label?: unknown; content?: unknown }> };
    for (const hit of payload.hits ?? []) {
      if (typeof hit.label === "string" && typeof hit.content === "string") {
        hits.push({ label: hit.label, content: hit.content });
      }
    }
  }
  return hits;
}

/**
 * The scripted answer: each quote as its own paragraph, cited with the label
 * of the first hit that contains it. Null when any quote is missing from the
 * evidence, so the turn says it has not enough evidence instead of citing
 * something search did not return.
 */
export function scriptedAnswer(quotes: readonly string[], hits: EvidenceHit[]): string | null {
  const paragraphs: string[] = [];
  for (const quote of quotes) {
    const needle = normalizeForEvidenceMatch(quote);
    const hit = hits.find((candidate) => normalizeForEvidenceMatch(candidate.content).includes(needle));
    if (!hit) {
      return null;
    }
    paragraphs.push(`${quote} ${hit.label}`);
  }
  return paragraphs.join("\n\n");
}

function demoModel(): Model<"openai-completions"> {
  return {
    ...glm53FlashModel(),
    id: DEMO_MODEL_ID,
    name: "Demo script (no model)",
    provider: "useful-brain-demo",
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * The demo's stand-in for the chat model. It never calls a model: the first
 * step searches, the second answers from the scripted quotes found in the
 * search results. Off-script questions search too, then decline.
 */
export function createDemoRuntime(): AgentRuntime {
  const model = demoModel();
  const stream: StreamFunction<"openai-completions"> = (requestModel, context, options) => {
    const core = createFauxCore({
      api: model.api,
      provider: model.provider,
      models: [{ id: model.id, name: model.name }],
      tokensPerSecond: TOKENS_PER_SECOND,
    });
    core.setResponses([
      async (ctx) => {
        const { question, after } = currentTurn(ctx);
        const scripted = matchDemoQuestion(question);
        const searched = after.some(
          (message) => message.role === "toolResult" && message.toolName === SEARCH_KNOWLEDGE_TOOL,
        );
        if (!searched) {
          await wait(SEARCH_DELAY_MS, options?.signal);
          return fauxAssistantMessage(
            [fauxToolCall(SEARCH_KNOWLEDGE_TOOL, { query: scripted?.searchQuery ?? question })],
            { stopReason: "toolUse" },
          );
        }
        const answer = scripted ? scriptedAnswer(scripted.quotes, evidenceHits(after)) : null;
        return fauxAssistantMessage([fauxText(answer ?? BRAIN_NOT_ENOUGH_EVIDENCE)], {
          stopReason: "stop",
        });
      },
    ]);
    return core.streamSimple(requestModel, context, options) as ReturnType<
      StreamFunction<"openai-completions">
    >;
  };
  return { model, stream };
}
