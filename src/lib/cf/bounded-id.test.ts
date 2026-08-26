import { describe, expect, it } from "vitest";

import { BoundedIdError, parseBoundedId } from "./bounded-id";

describe("bounded IDs", () => {
  it("accepts a compact identifier", () => {
    expect(parseBoundedId("conv-1.run_id", "conversation id")).toBe("conv-1.run_id");
  });

  it("rejects empty, oversized or hostile identifiers", () => {
    expect(() => parseBoundedId("", "run id")).toThrow(BoundedIdError);
    expect(() => parseBoundedId("x".repeat(129), "run id")).toThrow(BoundedIdError);
    expect(() => parseBoundedId("../etc/passwd", "run id")).toThrow(BoundedIdError);
    expect(() => parseBoundedId("id with space", "run id")).toThrow(BoundedIdError);
  });
});
