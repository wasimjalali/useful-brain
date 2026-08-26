import { describe, expect, it, vi } from "vitest";

import { redactOperationalLog, writeOperationalLog, type OperationalLog } from "./operational-log";

describe("operational logs", () => {
  it("keeps the approved fields and drops private content", () => {
    const redacted = redactOperationalLog({
      requestId: "11111111-1111-4111-8111-111111111111",
      principalKind: "user",
      operation: "whoami",
      status: "ok",
      durationMs: 12,
      modelId: "@cf/test",
      inputTokens: 10,
      outputTokens: 4,
      retrievalConfigVersion: "v1",
      corpusGeneration: 3,
      errorCode: undefined,
      prompt: "secret question",
      retrievedText: "private document",
    } as OperationalLog & { prompt: string; retrievedText: string });
    expect(redacted).toEqual({
      requestId: "11111111-1111-4111-8111-111111111111",
      principalKind: "user",
      operation: "whoami",
      status: "ok",
      durationMs: 12,
      modelId: "@cf/test",
      inputTokens: 10,
      outputTokens: 4,
      retrievalConfigVersion: "v1",
      corpusGeneration: 3,
    });
    expect(JSON.stringify(redacted)).not.toMatch(/prompt|retrievedText|secret question/);
  });

  it("does not log Access assertions or secrets", () => {
    const redacted = redactOperationalLog({
      requestId: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
      operation: "verify",
      status: "error",
      durationMs: 1,
      errorCode: "AUTH_REQUIRED",
    });
    expect(redacted.requestId).toBeUndefined();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    writeOperationalLog({
      requestId: "22222222-2222-4222-8222-222222222222",
      operation: "whoami",
      status: "ok",
      durationMs: 3,
    });
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        requestId: "22222222-2222-4222-8222-222222222222",
        operation: "whoami",
        status: "ok",
        durationMs: 3,
      }),
    );
    log.mockRestore();
  });
});
