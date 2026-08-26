import {
  assertIdentityConfiguration,
  parseIdentityMode,
  parseRuntimeEnv,
  type RuntimeEnv,
} from "../auth/identity-mode";

export class StartupConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartupConfigError";
  }
}

export function assertWorkerStartup(env: {
  RUNTIME_ENV?: string;
  IDENTITY_MODE?: string;
  RESOURCES_PROVISIONED?: string;
  WRANGLER_ACCESS_DEV?: string;
}): { runtimeEnv: RuntimeEnv; identityMode: ReturnType<typeof parseIdentityMode> } {
  const runtimeEnv = parseRuntimeEnv(env.RUNTIME_ENV);
  const identityMode = parseIdentityMode(env.IDENTITY_MODE);
  const wranglerAccessDevConfigured = env.WRANGLER_ACCESS_DEV === "true";
  assertIdentityConfiguration({
    runtimeEnv,
    identityMode,
    wranglerAccessDevConfigured,
  });
  if (
    (runtimeEnv === "staging" || runtimeEnv === "production") &&
    env.RESOURCES_PROVISIONED !== "true"
  ) {
    throw new StartupConfigError(
      `${runtimeEnv} cannot start with placeholder Cloudflare resources`,
    );
  }
  return { runtimeEnv, identityMode };
}
