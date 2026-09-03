export type IdentityMode = "access" | "loopback" | "session" | "disabled";
export type RuntimeEnv = "development" | "staging" | "production";

export class IdentityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityConfigError";
  }
}

export function parseIdentityMode(raw: string | undefined): IdentityMode {
  const value = raw?.trim();
  if (value === "access" || value === "loopback" || value === "session" || value === "disabled") {
    return value;
  }
  throw new IdentityConfigError("IDENTITY_MODE must be access, loopback, session or disabled");
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
  }

  if (config.runtimeEnv === "staging" && config.loopbackRuntimeConfigured) {
    throw new IdentityConfigError(
      "staging must not enable the loopback runtime signal",
    );
  }

  if (config.runtimeEnv === "production" && config.identityMode === "disabled") {
    throw new IdentityConfigError(
      "production cannot use disabled identity; use session, loopback on 127.0.0.1 or Access",
    );
  }

  if (config.runtimeEnv === "staging") {
    if (config.identityMode === "loopback") {
      throw new IdentityConfigError("loopback identity is not allowed on staging workers.dev");
    }
    if (
      config.identityMode !== "access" &&
      config.identityMode !== "session" &&
      config.identityMode !== "disabled"
    ) {
      throw new IdentityConfigError(
        "staging must use session, Access or the authorized disabled smoke exception",
      );
    }
  }

  if (config.identityMode === "access" && config.wranglerAccessDevConfigured) {
    throw new IdentityConfigError("Access mode cannot combine with Wrangler access.dev");
  }
  if (config.identityMode === "access" && config.loopbackRuntimeConfigured) {
    throw new IdentityConfigError("Access mode cannot combine with the loopback runtime signal");
  }
  if (config.identityMode === "session" && config.wranglerAccessDevConfigured) {
    throw new IdentityConfigError("session mode cannot combine with Wrangler access.dev");
  }
  if (config.identityMode === "session" && config.loopbackRuntimeConfigured) {
    throw new IdentityConfigError("session mode cannot combine with the loopback runtime signal");
  }

  if (config.identityMode === "loopback") {
    if (config.runtimeEnv === "staging") {
      throw new IdentityConfigError("loopback identity is not allowed on staging workers.dev");
    }
    if (!config.loopbackRuntimeConfigured) {
      throw new IdentityConfigError(
        "loopback identity requires the trusted local LOOPBACK_RUNTIME signal",
      );
    }
  }
}
