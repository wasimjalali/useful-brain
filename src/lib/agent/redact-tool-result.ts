import { AGENT_BUDGETS } from "./budgets";

const UNTRUSTED_PREFIXES = ["UNTRUSTED_EVIDENCE\n", "UNTRUSTED_CONNECTOR_RESULT\n"];
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._\-+=/]+/gi;
const BASIC_RE = /\bAuthorization:\s*Basic\s+[A-Za-z0-9+/=]+/gi;
const COOKIE_RE = /\b(?:Set-)?Cookie:\s*[^\r\n]+/gi;
const JSON_AUTH_SCHEME_RE =
  /(["']authorization["']\s*:\s*["'])(Bearer|Basic|Token)\s+([^"']+)(["'])/gi;
const JSON_COOKIE_RE = /(["'](?:set-cookie|cookie)["']\s*:\s*["'])([^"']+)(["'])/gi;
const SECRET_ASSIGNMENT_RE =
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret)\b["']?\s*[:=]\s*["']?[^\s"',}]+/gi;
const AUTHORIZATION_EQUALS_RE = /\bauthorization\b["']?\s*=\s*["']?[^\s"',}]+/gi;
const SECRET_JSON_KEY_RE =
  /^(authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret)$/i;

function utf8TrailingSequenceLength(startByte: number): number {
  if (startByte < 0x80) {
    return 0;
  }
  if (startByte < 0xe0) {
    return 1;
  }
  if (startByte < 0xf0) {
    return 2;
  }
  return 3;
}

export function boundUtf8Bytes(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= maxBytes) {
    return text;
  }
  let end = Math.max(0, maxBytes);
  let start = end - 1;
  while (start > 0 && (bytes[start] & 0xc0) === 0x80) {
    start -= 1;
  }
  const needed = utf8TrailingSequenceLength(bytes[start] ?? 0);
  if (end - 1 - start < needed) {
    end = start;
  }
  return new TextDecoder().decode(bytes.subarray(0, end));
}

export function redactJsonSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactJsonSecrets);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SECRET_JSON_KEY_RE.test(key) ? "[REDACTED]" : redactJsonSecrets(nested),
      ]),
    );
  }
  return value;
}

function redactPlainTextSecrets(text: string): string {
  return text
    .replace(BEARER_RE, "Bearer [REDACTED]")
    .replace(BASIC_RE, "Authorization: Basic [REDACTED]")
    .replace(COOKIE_RE, (header) =>
      header.toLowerCase().startsWith("set-cookie:") ? "Set-Cookie: [REDACTED]" : "Cookie: [REDACTED]",
    )
    .replace(JSON_AUTH_SCHEME_RE, "$1$2 [REDACTED]$4")
    .replace(JSON_COOKIE_RE, "$1[REDACTED]$3")
    .replace(SECRET_ASSIGNMENT_RE, "$1=[REDACTED]")
    .replace(AUTHORIZATION_EQUALS_RE, "authorization=[REDACTED]");
}

export function redactToolResultForStorage(
  text: string,
  maxBytes = AGENT_BUDGETS.maxRedactedToolResultBytes,
): string {
  let stripped = text;
  for (const prefix of UNTRUSTED_PREFIXES) {
    if (stripped.startsWith(prefix)) {
      stripped = stripped.slice(prefix.length);
      break;
    }
  }
  let scrubbed = stripped;
  try {
    scrubbed = JSON.stringify(redactJsonSecrets(JSON.parse(stripped)));
  } catch {
    scrubbed = redactPlainTextSecrets(stripped);
  }
  return boundUtf8Bytes(scrubbed, maxBytes);
}
