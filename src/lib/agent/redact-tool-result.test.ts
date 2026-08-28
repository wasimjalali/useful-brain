import { describe, expect, it } from "vitest";

import { AGENT_BUDGETS } from "./budgets";
import { boundUtf8Bytes, redactToolResultForStorage } from "./redact-tool-result";

describe("persisted tool-result redaction", () => {
  it("scrubs bearer tokens and secret assignments after stripping untrusted prefixes", () => {
    expect(
      redactToolResultForStorage(
        "UNTRUSTED_CONNECTOR_RESULT\nAuthorization: Bearer supersecret.token authorization=also-secret",
      ),
    ).toBe("Authorization: Bearer [REDACTED] authorization=[REDACTED]");
    expect(redactToolResultForStorage('UNTRUSTED_EVIDENCE\n{"api_key":"sk-live-aaaa"}')).toBe(
      '{"api_key":"[REDACTED]"}',
    );
    expect(
      redactToolResultForStorage(
        "Cookie: session=portfolio-secret\nAuthorization: Basic dXNlcjpwYXNz",
      ),
    ).toBe("Cookie: [REDACTED]\nAuthorization: Basic [REDACTED]");
    expect(
      redactToolResultForStorage(
        '{"Authorization":"Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==","Cookie":"session=portfolio-secret"}',
      ),
    ).toBe('{"Authorization":"[REDACTED]","Cookie":"[REDACTED]"}');
    expect(
      redactToolResultForStorage(
        '{"authorization": "Bearer supersecret.token", "Set-Cookie": "sid=abc"}',
      ),
    ).toBe('{"authorization":"[REDACTED]","Set-Cookie":"[REDACTED]"}');
    expect(
      redactToolResultForStorage(
        '{"Authorization":"ApiKey top-secret","nested":{"password":"correct horse battery"}}',
      ),
    ).toBe('{"Authorization":"[REDACTED]","nested":{"password":"[REDACTED]"}}');
  });

  it("bounds storage by UTF-8 bytes rather than JS string length", () => {
    const cjk = "你".repeat(32_768);
    const emoji = "😀".repeat(16_384);
    expect(new TextEncoder().encode(cjk).byteLength).toBe(98_304);
    expect(new TextEncoder().encode(emoji).byteLength).toBe(65_536);
    const boundedCjk = boundUtf8Bytes(cjk, AGENT_BUDGETS.maxRedactedToolResultBytes);
    const boundedEmoji = redactToolResultForStorage(emoji);
    expect(new TextEncoder().encode(boundedCjk).byteLength).toBeLessThanOrEqual(
      AGENT_BUDGETS.maxRedactedToolResultBytes,
    );
    expect(new TextEncoder().encode(boundedEmoji).byteLength).toBeLessThanOrEqual(
      AGENT_BUDGETS.maxRedactedToolResultBytes,
    );
    expect(boundedCjk.startsWith("你")).toBe(true);
  });
});
