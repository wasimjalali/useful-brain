import { describe, expect, it } from "vitest";

import { AuthValidationError } from "./session-errors";
import { nameFromEmail, normalizeEmail, normalizePassword } from "./session-account";

describe("account credentials", () => {
  it("normalizes email to lowercase and rejects malformed values", () => {
    expect(normalizeEmail("  Alex@Example.COM ")).toBe("alex@example.com");
    expect(() => normalizeEmail("")).toThrow(AuthValidationError);
    expect(() => normalizeEmail("not-an-email")).toThrow(/valid email/);
    expect(() => normalizeEmail("a@b@c.com")).toThrow(/valid email/);
    expect(() => normalizeEmail("alex example.com")).toThrow(/valid email/);
  });

  it("requires a bounded password", () => {
    expect(normalizePassword("abcdefgh")).toBe("abcdefgh");
    expect(() => normalizePassword("short")).toThrow(/at least 8/);
    expect(() => normalizePassword("x".repeat(129))).toThrow(/too long/);
  });

  it("derives a display name from the email local part when none is given", () => {
    expect(nameFromEmail("wasim.jalali@example.com", undefined)).toBe("wasim jalali");
    expect(nameFromEmail("wasim@example.com", " Wasim ")).toBe("Wasim");
  });
});
