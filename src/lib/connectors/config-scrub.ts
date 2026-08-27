export const SECRET_BINDING_RE = /^CONNECTOR_[A-Z0-9_]+$/;

const SECRET_KEYS = new Set([
  "token",
  "password",
  "api_key",
  "apikey",
  "secret",
  "authorization",
  "access_token",
  "refresh_token",
  "bearer",
]);

export class ConnectorConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorConfigError";
  }
}

function isSecretKey(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === "secret_binding") {
    return false;
  }
  if (SECRET_KEYS.has(lower)) {
    return true;
  }
  return lower.endsWith("_token") || lower.endsWith("_secret");
}

function sanitizeValue(value: unknown, path: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return sanitizeMapping(value as Record<string, unknown>, path.endsWith(".") || path === "" ? path : `${path}.`);
  }
  return value;
}

function sanitizeMapping(config: Record<string, unknown>, path = ""): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const here = `${path}${key}`;
    if (isSecretKey(key)) {
      throw new ConnectorConfigError(
        `config must not store a secret under '${here}'. Pass a named secret_binding instead.`,
      );
    }
    if (key.toLowerCase() === "secret_binding") {
      if (value != null && value !== "") {
        cleaned[key] = validateSecretBinding(String(value));
      }
      continue;
    }
    cleaned[key] = sanitizeValue(value, here);
  }
  return cleaned;
}

export function validateSecretBinding(raw: string): string {
  const name = raw.trim();
  if (!SECRET_BINDING_RE.test(name)) {
    throw new ConnectorConfigError(
      "secret_binding must be a named CONNECTOR_* Worker secret binding",
    );
  }
  return name;
}

export function sanitizeStoredConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new ConnectorConfigError("config must be an object");
  }
  return sanitizeMapping(config as Record<string, unknown>);
}
