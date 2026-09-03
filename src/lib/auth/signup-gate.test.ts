import { describe, expect, it } from "vitest";

import { SignupClosedError, assertSignupAllowed } from "./signup-gate";

describe("signup gate", () => {
  it("closes signup entirely when no code is configured", () => {
    expect(() => assertSignupAllowed(undefined, "anything")).toThrow(SignupClosedError);
    expect(() => assertSignupAllowed("", "anything")).toThrow(SignupClosedError);
  });

  it("requires the exact configured code", () => {
    expect(() => assertSignupAllowed("letmein-2026", "letmein-2026")).not.toThrow();
    expect(() => assertSignupAllowed("letmein-2026", " wrong ")).toThrow(SignupClosedError);
    expect(() => assertSignupAllowed("letmein-2026", undefined)).toThrow(SignupClosedError);
    expect(() => assertSignupAllowed("letmein-2026", 12345)).toThrow(SignupClosedError);
  });

  it("rejects oversized input", () => {
    expect(() => assertSignupAllowed("short", "x".repeat(129))).toThrow(SignupClosedError);
  });
});
