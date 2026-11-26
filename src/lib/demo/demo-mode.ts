/**
 * The public demo (`DEMO_MODE=true`): every visitor is signed in as their own
 * demo admin, answers come from the scripted runtime (no model binding) and
 * nothing a visitor does can change the shared sample data.
 */
export const DEMO_READ_ONLY_MESSAGE = "Changes are turned off in this demo.";

export class DemoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoConfigError";
  }
}

export function isDemoMode(env: { DEMO_MODE?: string }): boolean {
  return env.DEMO_MODE === "true";
}

/**
 * Fails closed on a demo that could reach a model or skip sign-in: the demo
 * runs only on session identity and never with a Workers AI binding.
 */
export function assertDemoConfiguration(env: {
  DEMO_MODE?: string;
  IDENTITY_MODE?: string;
  AI?: unknown;
}): void {
  if (env.DEMO_MODE !== undefined && env.DEMO_MODE !== "true" && env.DEMO_MODE !== "false") {
    throw new DemoConfigError("DEMO_MODE must be true or false");
  }
  if (!isDemoMode(env)) {
    return;
  }
  if (env.IDENTITY_MODE !== "session") {
    throw new DemoConfigError("the demo runs only with session identity");
  }
  if (env.AI !== undefined) {
    throw new DemoConfigError("the demo must not bind Workers AI");
  }
}

/** Requests a demo visitor may make that write: their own chats, nothing shared. */
const VISITOR_WRITES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/turns$/ },
  { method: "POST", pattern: /^\/cancel$/ },
  { method: "POST", pattern: /^\/lock$/ },
  { method: "POST", pattern: /^\/unlock$/ },
  { method: "DELETE", pattern: /^\/conversations\/[^/]+$/ },
  { method: "POST", pattern: /^\/messages\/[^/]+\/feedback$/ },
  { method: "DELETE", pattern: /^\/messages\/[^/]+\/feedback$/ },
  { method: "POST", pattern: /^\/messages\/[^/]+\/request-document$/ },
  { method: "POST", pattern: /^\/document-requests$/ },
];

/** Reads always pass. A write passes only when it is on the visitor allowlist. */
export function demoRequestAllowed(method: string, path: string): boolean {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD") {
    return true;
  }
  return VISITOR_WRITES.some((entry) => entry.method === verb && entry.pattern.test(path));
}
