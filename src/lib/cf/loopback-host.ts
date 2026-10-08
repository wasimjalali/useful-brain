const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::(\d{1,5}))?$/i;

/** True for Host values 127.0.0.1, localhost or [::1], each with an optional port. */
export function isLoopbackHost(host: string | null | undefined): boolean {
  const match = host ? LOOPBACK_HOST.exec(host) : null;
  if (!match) {
    return false;
  }
  return match[1] === undefined || Number(match[1]) <= 65535;
}

/**
 * DNS-rebinding guard. In loopback mode Brain trusts the local operator without a
 * cookie, so the Host header (which a rebinding page cannot make loopback-looking)
 * must name the loopback interface. Session mode is unaffected: its cookie is
 * host-scoped, so a rebinding page has none.
 */
export function hostAllowedForRuntime(
  env: { LOOPBACK_RUNTIME?: string } | undefined,
  host: string | null | undefined,
): boolean {
  if (env?.LOOPBACK_RUNTIME !== "true") {
    return true;
  }
  return isLoopbackHost(host);
}
