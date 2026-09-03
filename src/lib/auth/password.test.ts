import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a hash of the same password and rejects a different password", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(/^pbkdf2\$sha256\$100000\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("wrong password", stored)).toBe(false);
  });

  it("uses a unique salt so the same password does not hash identically twice", async () => {
    const first = await hashPassword("repeat-me");
    const second = await hashPassword("repeat-me");
    expect(first).not.toBe(second);
    expect(await verifyPassword("repeat-me", first)).toBe(true);
    expect(await verifyPassword("repeat-me", second)).toBe(true);
  });

  it("rejects a truncated or unknown hash string without throwing", async () => {
    expect(await verifyPassword("secret", "not-a-hash")).toBe(false);
    expect(await verifyPassword("secret", "pbkdf2$sha256$100000$ab")).toBe(false);
  });
});
