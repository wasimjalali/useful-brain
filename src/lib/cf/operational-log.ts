export const OPERATIONAL_LOG_FIELDS = [
  "requestId",
  "principalKind",
  "operation",
  "status",
  "durationMs",
  "modelId",
  "inputTokens",
  "outputTokens",
  "retrievalConfigVersion",
  "corpusGeneration",
  "errorCode",
] as const;

export type OperationalLogField = (typeof OPERATIONAL_LOG_FIELDS)[number];

export type OperationalLog = {
  requestId: string;
  principalKind?: "user" | "service_token";
  operation: string;
  status: "ok" | "error";
  durationMs: number;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  retrievalConfigVersion?: string;
  corpusGeneration?: number;
  errorCode?: string;
};

const ALLOWED_FIELDS = new Set<string>(OPERATIONAL_LOG_FIELDS);
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_VALUE =
  /cf-access-jwt|authorization|bearer\s+[a-z0-9._-]+|BEGIN [A-Z ]+PRIVATE KEY/i;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function redactOperationalLog(entry: OperationalLog): Record<string, string | number> {
  const redacted: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!ALLOWED_FIELDS.has(key) || value === undefined) {
      continue;
    }
    if (key === "requestId" && typeof value === "string" && !REQUEST_ID_PATTERN.test(value)) {
      continue;
    }
    if (typeof value === "string" && (FORBIDDEN_VALUE.test(value) || JWT_SHAPE.test(value))) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number") {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function writeOperationalLog(entry: OperationalLog): void {
  console.log(JSON.stringify(redactOperationalLog(entry)));
}
