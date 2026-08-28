import { AGENT_BUDGETS } from "./budgets";

const UNTRUSTED_PREFIXES = ["UNTRUSTED_EVIDENCE\n", "UNTRUSTED_CONNECTOR_RESULT\n"];
const JSON_AUTH_RE = /(["'](?:proxy-)?authorization["']\s*:\s*["'])([^"']+)(["'])/gi;
const JSON_COOKIE_RE = /(["'](?:set-cookie|cookie)["']\s*:\s*["'])([^"']+)(["'])/gi;
const SECRET_JSON_HEADER_KEY_RE = /^(?:x-)?(?:proxy-)?(?:authorization|cookie|set-cookie)$/;
const SECRET_JSON_SUFFIX_KEY_RE =
  /(?:^|-)(?:api-key|access-key|access-token|refresh-token|client-secret|private-key|password|secret|token)$/;

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
  if (typeof value === "string") {
    return redactPlainTextSecrets(value, true);
  }
  if (Array.isArray(value)) {
    if (
      value.length === 2 &&
      typeof value[0] === "string" &&
      isSecretJsonKey(value[0])
    ) {
      return [value[0], "[REDACTED]"];
    }
    return value.map(redactJsonSecrets);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        isSecretJsonKey(key) ? "[REDACTED]" : redactJsonSecrets(nested),
      ]),
    );
  }
  return value;
}

function normalizeCredentialKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[/_]/g, "-")
    .toLowerCase();
}

function isSecretJsonKey(key: string): boolean {
  const normalized = normalizeCredentialKey(key);
  return SECRET_JSON_HEADER_KEY_RE.test(normalized) || SECRET_JSON_SUFFIX_KEY_RE.test(normalized);
}

function redactPlainTextSecrets(text: string, throughEnd = false): string {
  const valuePattern = throughEnd ? "[\\s\\S]*" : "[^\\r\\n]*";
  const tokenPattern = throughEnd ? "[\\s\\S]+" : "[^\\s\\r\\n]+";
  return text
    .replace(
      new RegExp(`\\b((?:Proxy-)?Authorization):[ \\t]*${valuePattern}`, "gi"),
      (_, name: string) => `${name}: [REDACTED]`,
    )
    .replace(new RegExp(`\\bBearer\\s+${tokenPattern}`, "gi"), "Bearer [REDACTED]")
    .replace(new RegExp(`\\b((?:Set-)?Cookie):[ \\t]*${valuePattern}`, "gi"), (_, name: string) =>
      name.toLowerCase() === "set-cookie" ? "Set-Cookie: [REDACTED]" : "Cookie: [REDACTED]",
    )
    .replace(JSON_AUTH_RE, "$1[REDACTED]$3")
    .replace(JSON_COOKIE_RE, "$1[REDACTED]$3")
    .replace(
      new RegExp(
        `\\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|password|secret|token)\\b["']?\\s*[:=]\\s*["']?${valuePattern}`,
        "gi",
      ),
      "$1=[REDACTED]",
    )
    .replace(
      new RegExp(`\\b(?:proxy-)?authorization\\b["']?\\s*=\\s*["']?${valuePattern}`, "gi"),
      (assignment) =>
        assignment.toLowerCase().startsWith("proxy-")
          ? "proxy-authorization=[REDACTED]"
          : "authorization=[REDACTED]",
    );
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
