import { describe, expect, it } from "vitest";

import { AGENT_BUDGETS } from "./budgets";
import { boundUtf8Bytes, redactToolResultForStorage } from "./redact-tool-result";

describe("persisted tool-result redaction", () => {
  it("scrubs bearer tokens and secret assignments after stripping untrusted prefixes", () => {
    expect(
      redactToolResultForStorage(
        "UNTRUSTED_CONNECTOR_RESULT\nAuthorization: Bearer supersecret.token authorization=also-secret",
      ),
    ).toBe("Authorization: [REDACTED]");
    expect(redactToolResultForStorage('UNTRUSTED_EVIDENCE\n{"api_key":"sk-live-aaaa"}')).toBe(
      '{"api_key":"[REDACTED]"}',
    );
    expect(
      redactToolResultForStorage(
        "Cookie: session=portfolio-secret\nAuthorization: Basic dXNlcjpwYXNz",
      ),
    ).toBe("Cookie: [REDACTED]\nAuthorization: [REDACTED]");
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
    expect(
      redactToolResultForStorage('{"message":"Authorization: Bearer supersecret.token"}'),
    ).toBe('{"message":"Authorization: [REDACTED]"}');
    expect(
      redactToolResultForStorage("Authorization: Bearer abc~opaque-secret"),
    ).toBe("Authorization: [REDACTED]");
    expect(redactToolResultForStorage("Authorization: Token opaque-secret")).toBe(
      "Authorization: [REDACTED]",
    );
    expect(redactToolResultForStorage("Authorization: ApiKey top-secret")).toBe(
      "Authorization: [REDACTED]",
    );
    expect(redactToolResultForStorage("password: correct horse battery")).toBe(
      "password=[REDACTED]",
    );
    expect(
      redactToolResultForStorage('{"message":"password: correct horse battery"}'),
    ).toBe('{"message":"password=[REDACTED]"}');
    expect(
      redactToolResultForStorage(
        'Authorization: Digest username="Mufasa", response="response-secret"',
      ),
    ).toBe("Authorization: [REDACTED]");
    expect(redactToolResultForStorage("Authorization:ApiKey no-space-secret")).toBe(
      "Authorization: [REDACTED]",
    );
    expect(redactToolResultForStorage("Bearer abc~opaque-secret")).toBe("Bearer [REDACTED]");
    expect(
      redactToolResultForStorage("Proxy-Authorization: Basic cHJveHk6c2VjcmV0"),
    ).toBe("Proxy-Authorization: [REDACTED]");
    expect(redactToolResultForStorage('{"token":"opaque-secret"}')).toBe(
      '{"token":"[REDACTED]"}',
    );
    expect(redactToolResultForStorage('{"X-API-Key":"x-secret"}')).toBe(
      '{"X-API-Key":"[REDACTED]"}',
    );
    expect(
      redactToolResultForStorage('{"Proxy-Authorization":"Basic cHJveHk6c2VjcmV0"}'),
    ).toBe('{"Proxy-Authorization":"[REDACTED]"}');
    expect(
      redactToolResultForStorage('{"message":"Authorization: Token opaque-secret"}'),
    ).toBe('{"message":"Authorization: [REDACTED]"}');
    expect(
      redactToolResultForStorage(
        '{"message":"Authorization: Digest username=\\"Mufasa\\", response=\\"response-secret\\""}',
      ),
    ).toBe('{"message":"Authorization: [REDACTED]"}');
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

  it("redacts camelCase keys, header pairs, and multiline authorization leaves", () => {
    const secrets = [
      "abc123opaque",
      "YWJjOmRlZg==",
      "keep-secret",
      "still-secret",
    ];
    const payloads = [
      '{"openaiApiKey":"abc123opaque"}',
      '{"authToken":"abc123opaque"}',
      '{"idToken":"abc123opaque"}',
      '{"sessionToken":"abc123opaque"}',
      '{"secretAccessKey":"abc123opaque"}',
      '{"headers":[["Authorization","Basic YWJjOmRlZg=="]]}',
      JSON.stringify({ message: "Authorization: Bearer keep-secret\nstill-secret" }),
    ];
    for (const payload of payloads) {
      const redacted = redactToolResultForStorage(payload);
      for (const secret of secrets) {
        expect(redacted).not.toContain(secret);
      }
    }
    expect(redactToolResultForStorage('{"openaiApiKey":"abc123opaque"}')).toBe(
      '{"openaiApiKey":"[REDACTED]"}',
    );
    expect(
      redactToolResultForStorage('{"headers":[["Authorization","Basic YWJjOmRlZg=="]]}'),
    ).toBe('{"headers":[["Authorization","[REDACTED]"]]}');
    expect(
      redactToolResultForStorage(
        JSON.stringify({ message: "Authorization: Bearer keep-secret\nstill-secret" }),
      ),
    ).toBe('{"message":"Authorization: [REDACTED]"}');
  });
});
