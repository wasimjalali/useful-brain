export class SessionRequiredError extends Error {
  constructor() {
    super("Sign in to continue.");
    this.name = "SessionRequiredError";
  }
}

export class AuthValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthValidationError";
  }
}

export class AuthConflictError extends Error {
  constructor(message = "That email is already registered.") {
    super(message);
    this.name = "AuthConflictError";
  }
}

export class AuthInvalidCredentialsError extends Error {
  constructor() {
    super("That email or password is wrong.");
    this.name = "AuthInvalidCredentialsError";
  }
}

export class AuthRateLimitedError extends Error {
  constructor() {
    super("Try again in a few minutes.");
    this.name = "AuthRateLimitedError";
  }
}
