export class AccessConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AccessConfigError";
  }
}

export class AccessJwtError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AccessJwtError";
  }
}

export class AccessJwtUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AccessJwtUnavailable";
  }
}

export type AccessIdentity = {
  subject: string;
  kind: "user" | "service_token";
};

export type JwksFetcher = (url: string) => Promise<Response>;

const ALGORITHMS = new Set(["RS256"]);
const REQUIRED_CLAIMS = ["exp", "iat", "iss", "aud"] as const;
const LEEWAY_SECONDS = 60;
const JWKS_TTL_MS = 600_000;
const JWKS_MIN_REFETCH_MS = 60_000;
const JWKS_STALE_GRACE_MS = 3_600_000;
const MAX_TOKEN_BYTES = 8192;
const MAX_JWKS_BYTES = 262_144;
const HTTP_TIMEOUT_MS = 3000;
const NEVER = Number.NEGATIVE_INFINITY;

export type AccessJwtVerifierOptions = {
  teamDomain: string;
  audience: string;
  fetchJwks?: JwksFetcher;
  ttlMs?: number;
  minRefetchMs?: number;
  staleGraceMs?: number;
  nowElapsedMs?: () => number;
  nowWallSeconds?: () => number;
};

export function normaliseTeamDomain(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new AccessConfigError("Access team domain is empty");
  }
  if (trimmed.startsWith("http://")) {
    throw new AccessConfigError(`Access team domain must be https, not http: ${trimmed}`);
  }
  const value = trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AccessConfigError(`Access team domain does not form a usable URL: ${raw}`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== "/")) {
    throw new AccessConfigError(
      "Access team domain must be a bare hostname, with no path, query, fragment or credentials",
    );
  }
  return `${parsed.protocol}//${parsed.host}`;
}

function safe(value: string, limit = 64): string {
  const text = value.length <= limit ? value : `${value.slice(0, limit)}...(truncated)`;
  return JSON.stringify(text);
}

function base64UrlToBytes(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (segment.length % 4)) % 4);
  return Uint8Array.from(Buffer.from(padded, "base64"));
}

function decodeJson(segment: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as unknown;
}

function normaliseSubject(raw: string): string {
  const subject = raw.trim();
  if (!subject) {
    throw new AccessJwtError("Access token subject is empty");
  }
  if (![...subject].every((char) => char.charCodeAt(0) < 128)) {
    throw new AccessJwtError("Access token subject contains non-ASCII characters");
  }
  return subject.toLowerCase();
}

function audienceValues(aud: unknown): string[] {
  if (typeof aud === "string") {
    return [aud];
  }
  if (Array.isArray(aud) && aud.every((value) => typeof value === "string")) {
    return aud;
  }
  return [];
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export class AccessJwtVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly certsUrl: string;
  private readonly fetchJwks: JwksFetcher;
  private readonly ttlMs: number;
  private readonly minRefetchMs: number;
  private readonly staleGraceMs: number;
  private readonly nowElapsedMs: () => number;
  private readonly nowWallSeconds: () => number;
  private keys = new Map<string, JsonWebKey>();
  private fetchedAt = NEVER;
  private attemptedAt = NEVER;
  private fetchInFlight: Promise<Map<string, JsonWebKey>> | null = null;

  constructor(options: AccessJwtVerifierOptions) {
    this.issuer = normaliseTeamDomain(options.teamDomain);
    const audience = options.audience.trim();
    if (!audience) {
      throw new AccessConfigError("Access application audience (AUD tag) is empty");
    }
    this.audience = audience;
    this.certsUrl = `${this.issuer}/cdn-cgi/access/certs`;
    this.fetchJwks =
      options.fetchJwks ??
      ((url) => fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) }));
    this.ttlMs = options.ttlMs ?? JWKS_TTL_MS;
    this.minRefetchMs = options.minRefetchMs ?? JWKS_MIN_REFETCH_MS;
    this.staleGraceMs = options.staleGraceMs ?? JWKS_STALE_GRACE_MS;
    this.nowElapsedMs = options.nowElapsedMs ?? (() => performance.now());
    this.nowWallSeconds = options.nowWallSeconds ?? (() => Date.now() / 1000);
  }

  async verify(token: string): Promise<AccessIdentity> {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new AccessJwtError("empty Access token");
    }
    if (Buffer.byteLength(trimmed) > MAX_TOKEN_BYTES) {
      throw new AccessJwtError(`Access token exceeds ${MAX_TOKEN_BYTES} bytes`);
    }

    const parts = trimmed.split(".");
    if (parts.length !== 3) {
      throw new AccessJwtError("malformed Access token");
    }

    let header: Record<string, unknown>;
    try {
      const parsed = asRecord(decodeJson(parts[0]));
      if (!parsed) {
        throw new Error("header is not an object");
      }
      header = parsed;
    } catch (error) {
      throw new AccessJwtError("malformed Access token", { cause: error });
    }

    const alg = header.alg;
    if (typeof alg !== "string" || !ALGORITHMS.has(alg)) {
      throw new AccessJwtError(`Access token algorithm is not allowed: ${safe(String(alg))}`);
    }
    const kid = header.kid;
    if (typeof kid !== "string" || !kid) {
      throw new AccessJwtError("Access token carries no key id");
    }

    const jwk = await this.keyFor(kid);
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlToBytes(parts[2]);
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      { ...jwk, key_ops: ["verify"], ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      toArrayBuffer(signature),
      signingInput,
    );
    if (!ok) {
      throw new AccessJwtError("Access token rejected: signature verification failed");
    }

    let claims: Record<string, unknown>;
    try {
      const parsed = asRecord(decodeJson(parts[1]));
      if (!parsed) {
        throw new Error("payload is not an object");
      }
      claims = parsed;
    } catch (error) {
      throw new AccessJwtError("malformed Access token", { cause: error });
    }

    for (const claim of REQUIRED_CLAIMS) {
      if (claims[claim] === undefined || claims[claim] === null) {
        throw new AccessJwtError(`Access token rejected: missing ${claim}`);
      }
    }
    if (claims.iss !== this.issuer) {
      throw new AccessJwtError("Access token rejected: invalid issuer");
    }
    if (!audienceValues(claims.aud).includes(this.audience)) {
      throw new AccessJwtError("Access token rejected: invalid audience");
    }

    const now = this.nowWallSeconds();
    const exp = Number(claims.exp);
    const iat = Number(claims.iat);
    if (!Number.isFinite(exp) || now > exp + LEEWAY_SECONDS) {
      throw new AccessJwtError("Access token rejected: expired");
    }
    if (!Number.isFinite(iat) || now + LEEWAY_SECONDS < iat) {
      throw new AccessJwtError("Access token rejected: issued in the future");
    }
    if (claims.nbf !== undefined) {
      const nbf = Number(claims.nbf);
      if (!Number.isFinite(nbf) || now + LEEWAY_SECONDS < nbf) {
        throw new AccessJwtError("Access token rejected: not yet valid");
      }
    }

    if (claims.type !== "app") {
      throw new AccessJwtError(`Access token is not an application token (type=${safe(String(claims.type))})`);
    }

    const email = claims.email;
    if (typeof email === "string" && email.trim()) {
      if (!email.includes("@")) {
        throw new AccessJwtError("Access token email claim is not an address");
      }
      return { subject: normaliseSubject(email), kind: "user" };
    }
    const commonName = claims.common_name;
    if (typeof commonName === "string" && commonName.trim()) {
      if (commonName.includes("@")) {
        throw new AccessJwtError("service token common_name looks like an email address");
      }
      return { subject: normaliseSubject(commonName), kind: "service_token" };
    }
    throw new AccessJwtError("Access token carries neither email nor common_name");
  }

  private async keyFor(kid: string): Promise<JsonWebKey> {
    const now = this.nowElapsedMs();
    const cached = this.keys.get(kid);
    if (cached && now - this.fetchedAt < this.ttlMs) {
      return cached;
    }
    if (this.keys.size > 0 && now - this.attemptedAt < this.minRefetchMs) {
      return this.fallback(kid, now);
    }

    try {
      const fetched = await this.refreshKeys();
      const key = fetched.get(kid);
      if (!key) {
        throw new AccessJwtError(`unknown Access signing key: ${safe(kid)}`);
      }
      return key;
    } catch (error) {
      if (error instanceof AccessJwtError) {
        throw error;
      }
      return this.fallback(kid, this.nowElapsedMs(), error);
    }
  }

  private fallback(kid: string, now: number, cause?: unknown): JsonWebKey {
    const key = this.keys.get(kid);
    if (!key) {
      if (this.keys.size > 0 && now - this.fetchedAt < this.ttlMs) {
        throw new AccessJwtError(`unknown Access signing key: ${safe(kid)}`);
      }
      throw new AccessJwtUnavailable("Access signing keys could not be confirmed", { cause });
    }
    if (now - this.fetchedAt > this.staleGraceMs) {
      throw new AccessJwtUnavailable("Access signing keys are stale and cannot be refreshed", {
        cause,
      });
    }
    return key;
  }

  private async refreshKeys(): Promise<Map<string, JsonWebKey>> {
    if (this.fetchInFlight) {
      return this.fetchInFlight;
    }
    this.attemptedAt = this.nowElapsedMs();
    this.fetchInFlight = this.fetchKeys()
      .then((keys) => {
        this.keys = keys;
        this.fetchedAt = this.nowElapsedMs();
        return keys;
      })
      .finally(() => {
        this.fetchInFlight = null;
      });
    return this.fetchInFlight;
  }

  private async fetchKeys(): Promise<Map<string, JsonWebKey>> {
    let response: Response;
    try {
      response = await this.fetchJwks(this.certsUrl);
    } catch (error) {
      throw new AccessJwtUnavailable(
        `could not fetch Access signing keys from ${this.certsUrl}`,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new AccessJwtUnavailable(`could not fetch Access signing keys from ${this.certsUrl}`);
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > MAX_JWKS_BYTES) {
      throw new AccessJwtUnavailable(
        `Access signing key set at ${this.certsUrl} exceeded ${MAX_JWKS_BYTES} bytes`,
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(buffer)) as unknown;
    } catch (error) {
      throw new AccessJwtUnavailable(`Access signing key set at ${this.certsUrl} was not JSON`, {
        cause: error,
      });
    }
    const record = asRecord(payload);
    const rawKeys = record?.keys;
    if (!Array.isArray(rawKeys) || rawKeys.length === 0) {
      throw new AccessJwtUnavailable(`Access signing key set at ${this.certsUrl} carried no keys`);
    }
    const keys = new Map<string, JsonWebKey>();
    for (const entry of rawKeys) {
      const item = asRecord(entry);
      if (!item || typeof item.kid !== "string" || !item.kid) {
        continue;
      }
      if (item.kty !== "RSA" && item.kty !== undefined) {
        continue;
      }
      if (typeof item.n !== "string" || typeof item.e !== "string") {
        continue;
      }
      keys.set(item.kid, {
        kty: "RSA",
        n: item.n,
        e: item.e,
        alg: "RS256",
        ext: true,
      });
    }
    if (keys.size === 0) {
      throw new AccessJwtUnavailable(
        `Access signing key set at ${this.certsUrl} held no usable RSA keys`,
      );
    }
    return keys;
  }
}
