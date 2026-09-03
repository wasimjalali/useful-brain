import { describe, expect, it } from "vitest";

import { SignupClosedError } from "../auth/signup-gate";
import { toPublicWorkerError } from "./worker-errors";

describe("signup gate error mapping", () => {
  it("maps a closed signup to VALIDATION_FAILED without leaking config", () => {
    expect(toPublicWorkerError(new SignupClosedError(), "req-1")).toEqual({
      code: "VALIDATION_FAILED",
      message: "Signup is closed. Ask the operator for an account.",
      retryable: false,
      requestId: "req-1",
    });
  });
});
