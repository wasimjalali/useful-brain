export type IdentityMode = "access" | "loopback" | "disabled";
export type RuntimeEnv = "development" | "staging" | "production";

export class IdentityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityConfigError";
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
  loopbackRuntimeConfigured: boolean;
}): void {
  if (config.runtimeEnv === "staging" || config.runtimeEnv === "production") {
    if (config.wranglerAccessDevConfigured) {
      throw new IdentityConfigError(
        `${config.runtimeEnv} must not configure Wrangler access.dev`,
      );
    }
    if (config.loopbackRuntimeConfigured) {
      throw new IdentityConfigError(
        `${config.runtimeEnv} must not enable the loopback runtime signal`,
      );
    }
  }

  if (config.runtimeEnv === "production" && config.identityMode !== "access") {
    throw new IdentityConfigError(
      "production must use Access identity; loopback and disabled modes are forbidden",
    );
  }

  if (config.runtimeEnv === "staging") {
    if (config.identityMode === "loopback") {
      throw new IdentityConfigError("loopback identity is development-only");
    }
    if (config.identityMode !== "access" && config.identityMode !== "disabled") {
      throw new IdentityConfigError(
        "staging must use Access identity or the authorized disabled smoke exception",
      );
    }
  }

  if (config.identityMode === "access" && config.wranglerAccessDevConfigured) {
    throw new IdentityConfigError("Access mode cannot combine with Wrangler access.dev");
  }

  if (config.identityMode === "loopback") {
    if (config.runtimeEnv !== "development") {
      throw new IdentityConfigError("loopback identity is development-only");
    }
    if (!config.loopbackRuntimeConfigured) {
      throw new IdentityConfigError(
        "loopback identity requires the trusted local LOOPBACK_RUNTIME signal",
      );
    }
  }
}
