export class SignupClosedError extends Error {
  constructor() {
    super("Signup is closed. Ask the operator for an account.");
    this.name = "SignupClosedError";
  }
}

/**
 * Signup is invite-only for this portfolio deployment: the staging
 * workers.dev URL must not be publicly usable. SIGNUP_CODE, when set as a
 * Wrangler var (a value in `wrangler secret`-style config), is required on
 * every signup. When unset, signup is fully closed.
 */
export function assertSignupAllowed(
  signupCode: string | undefined,
  providedCode: unknown,
): void {
  if (!signupCode) {
    throw new SignupClosedError();
  }
  const trimmed = typeof providedCode === "string" ? providedCode.trim() : "";
  if (!trimmed || trimmed.length > 128 || trimmed !== signupCode) {
    throw new SignupClosedError();
  }
}
