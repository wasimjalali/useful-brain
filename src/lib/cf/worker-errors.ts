import { AccessJwtError, AccessJwtUnavailable } from "../auth/access-jwt";
import { IdentityConfigError } from "../auth/identity-mode";
import { PrincipalResolutionError } from "../auth/principal";
import { IngestQueueMessageError } from "../ingest/queue-message";
import { BoundedIdError } from "./bounded-id";
import { UnsignedPrincipalError } from "./service-binding-identity";
import { StartupConfigError } from "./startup";

export class WorkerValidationError extends Error {
  constructor(message = "The request is invalid.") {
    super(message);
    this.name = "WorkerValidationError";
  }
}

export class WorkerForbiddenError extends Error {
  constructor() {
    super("FORBIDDEN");
    this.name = "WorkerForbiddenError";
  }
}

export class WorkerBusyError extends Error {
  constructor(message = "An answer is already in progress.") {
    super(message);
    this.name = "WorkerBusyError";
  }
}

export class WorkerCancelledError extends Error {
  constructor() {
    super("The answer was stopped.");
    this.name = "WorkerCancelledError";
  }
}

export type WorkerErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "UNAVAILABLE"
  | "VALIDATION_FAILED"
  | "INTERNAL_ERROR"
  | "RATE_LIMITED"
  | "CANCELLED";

export type PublicWorkerError = {
  code: WorkerErrorCode;
  message: string;
  retryable: boolean;
  requestId: string;
};

const HOST_LEAK = /https?:\/\/|:\d{2,5}|cloudflareaccess\.com|127\.0\.0\.1/i;

export function toPublicWorkerError(error: unknown, requestId: string): PublicWorkerError {
  if (error instanceof WorkerForbiddenError) {
    return {
      code: "FORBIDDEN",
      message: "You cannot access that resource.",
      retryable: false,
      requestId,
    };
  }
  if (error instanceof WorkerBusyError) {
    return {
      code: "RATE_LIMITED",
      message: "An answer is already in progress.",
      retryable: true,
      requestId,
    };
  }
  if (error instanceof WorkerCancelledError) {
    return {
      code: "CANCELLED",
      message: "The answer was stopped.",
      retryable: false,
      requestId,
    };
  }
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
    error instanceof UnsignedPrincipalError
  ) {
    return {
      code: "AUTH_REQUIRED",
      message: "Sign in to continue.",
      retryable: false,
      requestId,
    };
  }
  if (
    error instanceof BoundedIdError ||
    error instanceof IngestQueueMessageError ||
    error instanceof WorkerValidationError
  ) {
    return {
      code: "VALIDATION_FAILED",
      message: "The request is invalid.",
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
          : body.code === "RATE_LIMITED"
            ? 429
            : body.code === "CANCELLED"
              ? 409
          : 500;
  return Response.json(body, {
    status: body.code === "FORBIDDEN" ? 403 : status,
    headers: { "x-request-id": requestId },
  });
}
