import { describe, expect, it } from "vitest";

import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  readSessionToken,
  requestIsSecure,
  serializeSessionCookie,
  sessionCookieHeader,
} from "./session-cookie";

describe("session cookie", () => {
  it("reads only the Useful Brain session cookie from a mixed Cookie header", () => {
    const headers = new Headers({
      cookie: `CF_Authorization=browser-cookie; ${SESSION_COOKIE_NAME}=tok_abc; other=1`,
    });
    expect(readSessionToken(headers)).toBe("tok_abc");
    expect(sessionCookieHeader(headers)).toBe(`${SESSION_COOKIE_NAME}=tok_abc`);
  });

  it("returns null when the session cookie is missing", () => {
    expect(readSessionToken(new Headers({ cookie: "other=1" }))).toBeNull();
    expect(sessionCookieHeader(new Headers())).toBeNull();
  });

  it("serializes an HttpOnly Lax cookie and omits Secure on loopback HTTP", () => {
    const encoded = serializeSessionCookie("tok_abc", { secure: false });
    expect(encoded).toContain(`${SESSION_COOKIE_NAME}=tok_abc`);
    expect(encoded).toContain("HttpOnly");
    expect(encoded).toContain("SameSite=Lax");
    expect(encoded).toContain("Path=/");
    expect(encoded).not.toContain("Secure");
    expect(serializeSessionCookie("tok_abc", { secure: true })).toContain("Secure");
    expect(clearSessionCookie({ secure: true })).toContain("Max-Age=0");
  });

  it("treats HTTPS and forwarded HTTPS as secure", () => {
    expect(requestIsSecure(new Request("https://brain.example/login"))).toBe(true);
    expect(requestIsSecure(new Request("http://127.0.0.1:3000/login"))).toBe(false);
    expect(
      requestIsSecure(
        new Request("http://useful-brain-staging.workers.dev/login", {
          headers: { "x-forwarded-proto": "https" },
        }),
      ),
    ).toBe(true);
  });
});
