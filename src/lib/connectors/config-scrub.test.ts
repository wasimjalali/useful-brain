import { describe, expect, it } from "vitest";

import { ConnectorConfigError, sanitizeStoredConfig } from "./config-scrub";

describe("connector config scrubbing", () => {
  it("refuses nested secrets and allows only named secret bindings", () => {
    expect(sanitizeStoredConfig({ owner: "acme", secret_binding: "CONNECTOR_GITHUB" })).toEqual({
      owner: "acme",
      secret_binding: "CONNECTOR_GITHUB",
    });
    expect(() => sanitizeStoredConfig({ auth: { token: "ghs_secret" } })).toThrow(ConnectorConfigError);
    expect(() => sanitizeStoredConfig({ secret_binding: "SANAD_CF_API_TOKEN" })).toThrow(/CONNECTOR_/);
    expect(() => sanitizeStoredConfig({ api_key: "x" })).toThrow(/secret/);
    expect(() => sanitizeStoredConfig({ accessToken: "x" })).toThrow(/secret/);
    expect(() => sanitizeStoredConfig({ nested: { clientSecret: "x" } })).toThrow(/secret/);
    expect(() => sanitizeStoredConfig({ "X-Api-Key": "x" })).toThrow(/secret/);
    expect(() => sanitizeStoredConfig({ clientApiKey: "x" })).toThrow(/secret/);
    expect(() => sanitizeStoredConfig({ dbPassword: "x" })).toThrow(/secret/);
  });
});
