export const MAX_CONVERSATION_EVENT_BYTES = 32_768;

export type ConversationEvent =
  | { type: "token"; text: string }
  | { type: "cancelled"; runId: string }
  | { type: "completed"; runId: string }
  | { type: "error"; code: string };

export function serializeConversationEvent(event: ConversationEvent): string {
  const json = JSON.stringify(event);
  if (new TextEncoder().encode(json).byteLength > MAX_CONVERSATION_EVENT_BYTES) {
    return JSON.stringify({ type: "error", code: "EVENT_TOO_LARGE" });
  }
  if (event.type === "error" && /:\d+|connection refused|econnrefused|127\.0\.0\.1/i.test(event.code)) {
    return JSON.stringify({ type: "error", code: "UNAVAILABLE" });
  }
  return json;
}
