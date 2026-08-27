import { describe, expect, it } from "vitest";

import { serializeConversationEvent } from "./conversation-events";

describe("conversation events", () => {
  it("strips transport detail from error codes", () => {
    expect(JSON.parse(serializeConversationEvent({ type: "error", code: "connection refused" }))).toEqual({
      type: "error",
      code: "UNAVAILABLE",
    });
    expect(JSON.parse(serializeConversationEvent({ type: "error", code: "127.0.0.1:8787" }))).toEqual({
      type: "error",
      code: "UNAVAILABLE",
    });
    expect(JSON.parse(serializeConversationEvent({ type: "error", code: "UNAVAILABLE" }))).toEqual({
      type: "error",
      code: "UNAVAILABLE",
    });
  });
});
