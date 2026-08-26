const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const REQUEST_ID_HEADER = "x-request-id";

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function resolveRequestId(headers: Headers): string {
  const incoming = headers.get(REQUEST_ID_HEADER)?.trim();
  if (incoming && UUID_PATTERN.test(incoming)) {
    return incoming;
  }
  return createRequestId();
}

export function withRequestId(headers: Headers, requestId: string): Headers {
  const next = new Headers(headers);
  next.set(REQUEST_ID_HEADER, requestId);
  return next;
}
