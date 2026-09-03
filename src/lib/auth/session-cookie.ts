export const SESSION_COOKIE_NAME = "usefulbrain.session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function readSessionToken(headers: Headers): string | null {
  const header = headers.get("cookie");
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = trimmed.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) {
      continue;
    }
    const value = trimmed.slice(separator + 1).trim();
    if (!value) {
      return null;
    }
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export function sessionCookieHeader(headers: Headers): string | null {
  const token = readSessionToken(headers);
  if (!token) {
    return null;
  }
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

export function serializeSessionCookie(
  token: string,
  options: { secure: boolean; maxAgeSeconds?: number } = { secure: true },
): string {
  const maxAge = options.maxAgeSeconds ?? SESSION_TTL_SECONDS;
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function clearSessionCookie(options: { secure: boolean }): string {
  return serializeSessionCookie("", { secure: options.secure, maxAgeSeconds: 0 });
}

export function requestIsSecure(request: Request): boolean {
  const url = new URL(request.url);
  if (url.protocol === "https:") {
    return true;
  }
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded === "https";
}
