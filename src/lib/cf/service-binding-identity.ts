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

export type BrainService = {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
};

export function createBrainBoundRequest(request: Request, path = "/whoami"): Request {
  const headers = new Headers();
  const assertion = readAccessAssertion(request.headers);
  if (assertion) {
    headers.set(ACCESS_ASSERTION_HEADER, assertion);
  }
  const requestId = request.headers.get("x-request-id");
  if (requestId) {
    headers.set("x-request-id", requestId);
  }
  return new Request(new URL(path, "https://brain.internal"), {
    method: "GET",
    headers,
  });
}

export function forwardIdentityToBrain(
  brain: BrainService,
  request: Request,
  path = "/whoami",
): Promise<Response> {
  return brain.fetch(createBrainBoundRequest(request, path));
}
