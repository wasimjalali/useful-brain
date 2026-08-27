import { describe, expect, it } from "vitest";

import { HttpAllowlistError, assertAllowlistedHttpUrl, fetchAllowlistedSource } from "./http-allowlist";

describe("HTTP allowlist connector", () => {
  const allowlist = { origins: ["https://docs.example.com"] };

  it("allows only listed http(s) origins and blocks userinfo and other schemes", () => {
    expect(assertAllowlistedHttpUrl("https://docs.example.com/a.md", allowlist).pathname).toBe("/a.md");
    expect(() => assertAllowlistedHttpUrl("https://evil.example/a.md", allowlist)).toThrow(HttpAllowlistError);
    expect(() => assertAllowlistedHttpUrl("https://user:pass@docs.example.com/a.md", allowlist)).toThrow(/userinfo/);
    expect(() => assertAllowlistedHttpUrl("file:///etc/passwd", allowlist)).toThrow(/http or https/);
  });

  it("does not follow redirects off the allowlist", async () => {
    await expect(
      fetchAllowlistedSource("https://docs.example.com/a.md", allowlist, async () => {
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/secret.md" },
        });
      }),
    ).rejects.toThrow(/redirects are not followed/);
  });
});
