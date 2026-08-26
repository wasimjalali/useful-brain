export type IdentityMode = "access" | "loopback" | "disabled";
export type RuntimeEnv = "development" | "staging" | "production";

export class IdentityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityConfigError";
  }
}

export class LoopbackIdentityError extends Error {
  constructor(message = "loopback identity is not available") {
    super(message);
    this.name = "LoopbackIdentityError";
  }
}

export function parseIdentityMode(raw: string | undefined): IdentityMode {
  const value = raw?.trim();
  if (value === "access" || value === "loopback" || value === "disabled") {
    return value;
  }
  throw new IdentityConfigError("IDENTITY_MODE must be access, loopback or disabled");
}

export function parseRuntimeEnv(raw: string | undefined): RuntimeEnv {
  const value = raw?.trim();
  if (value === "development" || value === "staging" || value === "production") {
    return value;
  }
  throw new IdentityConfigError("RUNTIME_ENV must be development, staging or production");
}

export function assertIdentityConfiguration(config: {
  runtimeEnv: RuntimeEnv;
  identityMode: IdentityMode;
  wranglerAccessDevConfigured: boolean;
}): void {
  if (config.runtimeEnv === "staging" || config.runtimeEnv === "production") {
    if (config.identityMode !== "access") {
      throw new IdentityConfigError(
        `${config.runtimeEnv} must use Access identity; loopback and disabled modes are forbidden`,
      );
    }
    if (config.wranglerAccessDevConfigured) {
      throw new IdentityConfigError(
        `${config.runtimeEnv} must not configure Wrangler access.dev`,
      );
    }
  }

  if (config.identityMode === "access" && config.wranglerAccessDevConfigured) {
    throw new IdentityConfigError("Access mode cannot combine with Wrangler access.dev");
  }
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "localhost";
}

export function assertedLoopbackAddress(address: string | undefined): string {
  if (!address || address.includes(",")) {
    throw new LoopbackIdentityError();
  }
  const value = address.trim();
  if (!isLoopbackAddress(value)) {
    throw new LoopbackIdentityError();
  }
  return value;
}
