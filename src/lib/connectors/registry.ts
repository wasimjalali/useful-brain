import { parseBoundedId } from "../cf/bounded-id";
import { sanitizeStoredConfig, validateSecretBinding } from "./config-scrub";

export type ConnectorKind = "http" | "github" | "mcp" | "action_sink" | "plugin";
export type ConnectorCapability = "read" | "write";
export type ConnectorAuth = "none" | "secret_binding";
export type DataClassification = "public" | "internal" | "restricted";
export type ConnectorHealth = "healthy" | "degraded" | "unhealthy" | "revoked";

export type ConnectorRecord = {
  id: string;
  kind: ConnectorKind;
  capability: ConnectorCapability;
  auth: ConnectorAuth;
  secretBinding?: string;
  rateLimitPerMinute: number;
  dataClassification: DataClassification;
  scopes: string[];
  health: ConnectorHealth;
  revoked: boolean;
  originAllowlist?: string[];
  config?: Record<string, unknown>;
};

export type ConnectorAuditEvent = {
  at: number;
  connectorId: string;
  action: string;
  detail: string;
};

export class ConnectorRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorRegistryError";
  }
}

export class ConnectorRegistry {
  private readonly connectors = new Map<string, ConnectorRecord>();
  private readonly calls: Array<{ connectorId: string; at: number }> = [];
  readonly audit: ConnectorAuditEvent[] = [];

  register(input: ConnectorRecord, now = Date.now()): ConnectorRecord {
    const id = parseBoundedId(input.id, "connector id");
    const config = input.config ? sanitizeStoredConfig(input.config) : undefined;
    const secretBinding =
      input.auth === "secret_binding"
        ? validateSecretBinding(input.secretBinding ?? "")
        : undefined;
    if (input.auth === "none" && input.secretBinding) {
      throw new ConnectorRegistryError("none-auth connectors cannot name a secret binding");
    }
    const record: ConnectorRecord = {
      ...input,
      id,
      secretBinding,
      config,
      revoked: false,
      health: input.health === "revoked" ? "healthy" : input.health,
    };
    this.connectors.set(id, record);
    this.audit.push({ at: now, connectorId: id, action: "register", detail: record.kind });
    return record;
  }

  get(id: string): ConnectorRecord {
    const record = this.connectors.get(parseBoundedId(id, "connector id"));
    if (!record) {
      throw new ConnectorRegistryError(`unknown connector ${id}`);
    }
    return record;
  }

  list(): ConnectorRecord[] {
    return [...this.connectors.values()];
  }

  revoke(id: string, now = Date.now()): ConnectorRecord {
    const record = this.get(id);
    record.revoked = true;
    record.health = "revoked";
    this.audit.push({ at: now, connectorId: record.id, action: "revoke", detail: "revoked" });
    return record;
  }

  assertUsable(id: string, scope: string, now = Date.now()): ConnectorRecord {
    const record = this.get(id);
    if (record.revoked || record.health === "revoked") {
      throw new ConnectorRegistryError(`${record.id} is revoked`);
    }
    if (!record.scopes.includes(scope)) {
      throw new ConnectorRegistryError(`${record.id} is missing scope ${scope}`);
    }
    const windowStart = now - 60_000;
    const recent = this.calls.filter((call) => call.connectorId === record.id && call.at >= windowStart);
    if (recent.length >= record.rateLimitPerMinute) {
      throw new ConnectorRegistryError(`${record.id} exceeded its rate limit`);
    }
    this.calls.push({ connectorId: record.id, at: now });
    this.audit.push({ at: now, connectorId: record.id, action: "call", detail: scope });
    return record;
  }
}

export function seedSyntheticConnectors(): ConnectorRegistry {
  const registry = new ConnectorRegistry();
  registry.register({
    id: "http-docs",
    kind: "http",
    capability: "read",
    auth: "none",
    rateLimitPerMinute: 30,
    dataClassification: "internal",
    scopes: ["http.read"],
    health: "healthy",
    revoked: false,
    originAllowlist: ["https://docs.example.com"],
  });
  registry.register({
    id: "mcp-northwind",
    kind: "mcp",
    capability: "read",
    auth: "none",
    rateLimitPerMinute: 20,
    dataClassification: "internal",
    scopes: ["mcp.read", "mcp.write"],
    health: "healthy",
    revoked: false,
  });
  registry.register({
    id: "action-sink",
    kind: "action_sink",
    capability: "write",
    auth: "secret_binding",
    secretBinding: "CONNECTOR_ACTION_SINK",
    rateLimitPerMinute: 10,
    dataClassification: "restricted",
    scopes: ["sink.write"],
    health: "healthy",
    revoked: false,
  });
  registry.register({
    id: "plugin-echo",
    kind: "plugin",
    capability: "read",
    auth: "none",
    rateLimitPerMinute: 30,
    dataClassification: "public",
    scopes: ["plugin.echo"],
    health: "healthy",
    revoked: false,
  });
  return registry;
}
