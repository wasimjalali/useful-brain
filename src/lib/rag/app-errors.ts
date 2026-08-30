export type AppErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "CORPUS_NOT_READY"
  | "PROVIDER_TEMPORARY"
  | "INVALID_MODEL_RESPONSE"
  | "VALIDATION_FAILED"
  | "INTERNAL_ERROR"
  | "CANCELLED";

export type PublicAppError = {
  code: AppErrorCode;
  message: string;
  retryable: boolean;
};

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: PublicAppError };

export class AppError extends Error implements PublicAppError {
  readonly code: AppErrorCode;
  readonly retryable: boolean;

  constructor(code: AppErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryable = retryable;
  }
}

const DEFAULT_PUBLIC_ERROR: PublicAppError = {
  code: "INTERNAL_ERROR",
  message: "The request could not be completed.",
  retryable: false,
};

const SANITIZED_PROVIDER_ERRORS: PublicAppError[] = [
  {
    code: "RATE_LIMITED",
    message: "The model service is rate limited. Try again shortly.",
    retryable: true,
  },
  {
    code: "PROVIDER_TEMPORARY",
    message: "The model service is temporarily unavailable. Try again.",
    retryable: true,
  },
  {
    code: "INVALID_MODEL_RESPONSE",
    message: "The model returned an invalid response.",
    retryable: false,
  },
  {
    code: "INTERNAL_ERROR",
    message: "The model connection is not configured.",
    retryable: false,
  },
  {
    code: "INTERNAL_ERROR",
    message: "The model request was rejected.",
    retryable: false,
  },
  {
    code: "CORPUS_NOT_READY",
    message: "No active corpus is ready for retrieval.",
    retryable: false,
  },
  {
    code: "RATE_LIMITED",
    message: "An answer is already in progress.",
    retryable: true,
  },
];

export function toPublicAppError(
  error: unknown,
  fallback: PublicAppError = DEFAULT_PUBLIC_ERROR,
): PublicAppError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  if (error instanceof Error) {
    if (error.message.includes("AUTH_REQUIRED")) {
      return {
        code: "AUTH_REQUIRED",
        message: "Sign in to continue.",
        retryable: false,
      };
    }
    if (error.message.includes("FORBIDDEN")) {
      return {
        code: "FORBIDDEN",
        message: "You do not have permission to perform this action.",
        retryable: false,
      };
    }
    const providerError = SANITIZED_PROVIDER_ERRORS.find(({ message }) =>
      error.message.includes(message),
    );

    if (providerError) {
      return { ...providerError };
    }
  }

  return fallback;
}

export function actionSuccess<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionFailure(
  error: unknown,
  fallback?: PublicAppError,
): ActionResult<never> {
  return {
    ok: false,
    error: toPublicAppError(error, fallback),
  };
}
