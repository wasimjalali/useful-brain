import { AGENT_BUDGETS } from "./budgets";

const UNTRUSTED_PREFIXES = ["UNTRUSTED_EVIDENCE\n", "UNTRUSTED_CONNECTOR_RESULT\n"];
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._\-+=/]+/gi;
const SECRET_ASSIGNMENT_RE =
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret)\b["']?\s*[:=]\s*["']?[^\s"',}]+/gi;
const AUTHORIZATION_EQUALS_RE = /\bauthorization\b["']?\s*=\s*["']?[^\s"',}]+/gi;

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
  const scrubbed = stripped
    .replace(BEARER_RE, "Bearer [REDACTED]")
    .replace(SECRET_ASSIGNMENT_RE, "$1=[REDACTED]")
    .replace(AUTHORIZATION_EQUALS_RE, "authorization=[REDACTED]");
  return boundUtf8Bytes(scrubbed, maxBytes);
}
