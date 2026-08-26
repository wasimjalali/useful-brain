import { describe, expect, it } from "vitest";

import { REQUEST_ID_HEADER, createRequestId, resolveRequestId, withRequestId } from "./request-id";

describe("request IDs", () => {
  it("creates a UUID request ID", () => {
    expect(createRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("reuses a valid incoming request ID and ignores junk", () => {
    const existing = "11111111-1111-4111-8111-111111111111";
    expect(resolveRequestId(new Headers({ [REQUEST_ID_HEADER]: existing }))).toBe(existing);
    expect(resolveRequestId(new Headers({ [REQUEST_ID_HEADER]: "not-a-uuid" }))).not.toBe(
      "not-a-uuid",
    );
  });

  it("writes the request ID onto outbound headers", () => {
    const requestId = createRequestId();
    expect(withRequestId(new Headers(), requestId).get(REQUEST_ID_HEADER)).toBe(requestId);
  });
});
