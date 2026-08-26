import { AccessJwtError, AccessJwtUnavailable } from "../auth/access-jwt";
import { IdentityConfigError, LoopbackIdentityError } from "../auth/identity-mode";
import { PrincipalResolutionError } from "../auth/principal";
import { UnsignedPrincipalError } from "./service-binding-identity";
import { StartupConfigError } from "./startup";

export type WorkerErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "UNAVAILABLE"
  | "VALIDATION_FAILED"
  | "INTERNAL_ERROR";

export type PublicWorkerError = {
  code: WorkerErrorCode;
  message: string;
  retryable: boolean;
  requestId: string;
};

const HOST_LEAK = /https?:\/\/|:\d{2,5}|cloudflareaccess\.com|127\.0\.0\.1/i;

export function toPublicWorkerError(error: unknown, requestId: string): PublicWorkerError {
  if (error instanceof AccessJwtUnavailable) {
    return {
      code: "UNAVAILABLE",
      message: "Identity verification is temporarily unavailable.",
      retryable: true,
      requestId,
    };
  }
  if (
    error instanceof AccessJwtError ||
    error instanceof PrincipalResolutionError ||
    error instanceof UnsignedPrincipalError ||
    error instanceof LoopbackIdentityError
  ) {
    return {
      code: "AUTH_REQUIRED",
      message: "Sign in to continue.",
      retryable: false,
      requestId,
    };
  }
  if (error instanceof StartupConfigError || error instanceof IdentityConfigError) {
    return {
      code: "INTERNAL_ERROR",
      message: "The worker is not configured to serve this environment.",
      retryable: false,
      requestId,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "The request could not be completed.",
    retryable: false,
    requestId,
  };
}

export function workerErrorResponse(error: unknown, requestId: string): Response {
  const body = toPublicWorkerError(error, requestId);
  if (HOST_LEAK.test(body.message)) {
    body.message = "The request could not be completed.";
    body.code = "INTERNAL_ERROR";
  }
  const status =
    body.code === "AUTH_REQUIRED" || body.code === "FORBIDDEN"
      ? 401
      : body.code === "UNAVAILABLE"
        ? 503
        : body.code === "VALIDATION_FAILED"
          ? 400
          : 500;
  return Response.json(body, {
    status: body.code === "FORBIDDEN" ? 403 : status,
    headers: { "x-request-id": requestId },
  });
}
