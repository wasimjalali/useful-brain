import { describe, expect, it } from "vitest";

import { AccessJwtError, AccessJwtUnavailable } from "../auth/access-jwt";
import { IdentityConfigError } from "../auth/identity-mode";
import {
  toPublicWorkerError,
  WorkerBusyError,
  WorkerValidationError,
  workerErrorResponse,
} from "./worker-errors";

describe("worker error contracts", () => {
  it("maps a bad token to AUTH_REQUIRED without leaking verifier detail", () => {
    expect(toPublicWorkerError(new AccessJwtError("invalid issuer"), "req-1")).toEqual({
      code: "AUTH_REQUIRED",
      message: "Sign in to continue.",
      retryable: false,
      requestId: "req-1",
    });
  });

  it("maps identity misconfiguration to INTERNAL_ERROR rather than a JWKS outage", () => {
    expect(toPublicWorkerError(new IdentityConfigError("bad mode"), "req-cfg")).toEqual({
      code: "INTERNAL_ERROR",
      message: "The worker is not configured to serve this environment.",
      retryable: false,
      requestId: "req-cfg",
    });
  });

  it("maps JWKS outage to UNAVAILABLE rather than invalid credentials", () => {
    expect(
      toPublicWorkerError(new AccessJwtUnavailable("could not fetch keys"), "req-2"),
    ).toEqual({
      code: "UNAVAILABLE",
      message: "Identity verification is temporarily unavailable.",
      retryable: true,
      requestId: "req-2",
    });
  });

  it("maps malformed JSON to VALIDATION_FAILED", () => {
    expect(toPublicWorkerError(new WorkerValidationError(), "req-json")).toEqual({
      code: "VALIDATION_FAILED",
      message: "The request is invalid.",
      retryable: false,
      requestId: "req-json",
    });
  });

  it("maps a held conversation lock to RATE_LIMITED", async () => {
    expect(toPublicWorkerError(new WorkerBusyError(), "req-busy")).toEqual({
      code: "RATE_LIMITED",
      message: "An answer is already in progress.",
      retryable: true,
      requestId: "req-busy",
    });
    const response = workerErrorResponse(new WorkerBusyError(), "req-busy");
    expect(response.status).toBe(429);
  });

  it("does not put hosts, ports or JWKS URLs in the JSON body", async () => {
    const response = workerErrorResponse(
      new Error("could not fetch https://karkoai.cloudflareaccess.com:443/cdn-cgi/access/certs"),
      "req-3",
    );
    const body = (await response.json()) as { message: string };
    expect(body.message).not.toMatch(/cloudflareaccess|:\d{2,5}|127\.0\.0\.1/);
  });
});
