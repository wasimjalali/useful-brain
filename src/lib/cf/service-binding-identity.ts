const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";

const SPOOFED_PRINCIPAL_HEADERS = [
  "x-useful-brain-principal",
  "x-principal",
  "cf-access-authenticated-user-email",
] as const;

export class UnsignedPrincipalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsignedPrincipalError";
  }
}

export function readAccessAssertion(headers: Headers): string | null {
  const token = headers.get(ACCESS_ASSERTION_HEADER)?.trim();
  return token || null;
}

export function rejectSpoofedPrincipal(headers: Headers): void {
  for (const name of SPOOFED_PRINCIPAL_HEADERS) {
    if (headers.get(name)) {
      throw new UnsignedPrincipalError(
        "Brain rejects an unsigned principal passed through a Service Binding",
      );
    }
  }
}

export function assertionForBrain(headers: Headers): string {
  rejectSpoofedPrincipal(headers);
  const token = readAccessAssertion(headers);
  if (!token) {
    throw new UnsignedPrincipalError("Missing Cf-Access-Jwt-Assertion");
  }
  return token;
}
