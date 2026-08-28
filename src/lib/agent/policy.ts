export type RiskClass = "read" | "reversible_write" | "external_write" | "high_risk";

export type ToolPolicy = {
  name: string;
  risk: RiskClass;
  executionMode: "sequential" | "parallel";
};

export type PolicyPrincipal = {
  id: string;
};

export type ApprovalBinding = {
  principalId: string;
  conversationId: string;
  tool: string;
  argumentFingerprint: string;
  idempotencyKey: string;
  expiresAt: number;
};

export type PolicyDecision =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "pending_approval"; binding: ApprovalBinding };

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

const REGISTRY: Record<string, ToolPolicy> = {
  search_knowledge: { name: "search_knowledge", risk: "read", executionMode: "parallel" },
  fetch_allowlisted_http: { name: "fetch_allowlisted_http", risk: "read", executionMode: "parallel" },
  mcp_lookup: { name: "mcp_lookup", risk: "read", executionMode: "parallel" },
  mcp_create_ticket: { name: "mcp_create_ticket", risk: "external_write", executionMode: "sequential" },
  action_sink_write: { name: "action_sink_write", risk: "external_write", executionMode: "sequential" },
  plugin_echo: { name: "plugin_echo", risk: "read", executionMode: "parallel" },
  create_draft: { name: "create_draft", risk: "reversible_write", executionMode: "sequential" },
  send_email: { name: "send_email", risk: "external_write", executionMode: "sequential" },
  delete_records: { name: "delete_records", risk: "high_risk", executionMode: "sequential" },
};

export function toolPolicy(name: string): ToolPolicy {
  const policy = REGISTRY[name];
  if (!policy) {
    throw new PolicyError(`unknown tool ${name}`);
  }
  return policy;
}

export function assertMutatingToolsSequential(name: string): void {
  const policy = toolPolicy(name);
  if (policy.risk !== "read" && policy.executionMode !== "sequential") {
    throw new PolicyError(`${name} must declare sequential execution`);
  }
}

export function evaluateToolPolicy(input: {
  tool: string;
  principal: PolicyPrincipal;
  conversationId: string;
  args: unknown;
  idempotencyKey: string;
  now: number;
  approval?: ApprovalBinding | null;
}): PolicyDecision {
  const policy = toolPolicy(input.tool);
  assertMutatingToolsSequential(input.tool);
  if (policy.risk === "high_risk") {
    return { action: "deny", reason: "high-risk actions are denied in the first release" };
  }
  if (policy.risk === "read") {
    return { action: "allow" };
  }
  const fingerprint = argumentFingerprint(input.args);
  const binding: ApprovalBinding = {
    principalId: input.principal.id,
    conversationId: input.conversationId,
    tool: input.tool,
    argumentFingerprint: fingerprint,
    idempotencyKey: input.idempotencyKey,
    expiresAt: input.approval?.expiresAt ?? input.now + 15 * 60 * 1000,
  };
  if (!input.approval) {
    return { action: "pending_approval", binding };
  }
  if (!approvalsMatch(input.approval, binding, input.now)) {
    return { action: "deny", reason: "approval does not match principal, tool, arguments or key" };
  }
  return { action: "allow" };
}

export function normalizeToolArguments(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeToolArguments);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeToolArguments(nested)]),
    );
  }
  return value;
}

export function argumentFingerprint(value: unknown): string {
  return JSON.stringify(normalizeToolArguments(value));
}

export function approvalsMatch(
  stored: ApprovalBinding,
  next: ApprovalBinding,
  now: number,
): boolean {
  if (now > stored.expiresAt) {
    return false;
  }
  return (
    stored.principalId === next.principalId &&
    stored.conversationId === next.conversationId &&
    stored.tool === next.tool &&
    stored.argumentFingerprint === next.argumentFingerprint &&
    stored.idempotencyKey === next.idempotencyKey &&
    stored.expiresAt === next.expiresAt
  );
}

/** Central gateway. Every tool execute() path must call this before any side effect. */
export function policyGateway(input: Parameters<typeof evaluateToolPolicy>[0]): PolicyDecision {
  return evaluateToolPolicy(input);
}
