import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  AccessConfigError,
  AccessJwtError,
  AccessJwtUnavailable,
  AccessJwtVerifier,
  normaliseTeamDomain,
  type AccessJwtVerifierOptions,
} from "./access-jwt";

const TEAM = "https://karkoai.cloudflareaccess.com";
const AUD = "32eafc7626e974616deaf0dc3ce63d7bcbed58a2731e84d06bc3cdf1b53c4228";

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function b64urlBytes(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).toString(
    "base64url",
  );
}

async function generateSigning(kid = "kid-1") {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    jwk: { ...jwk, kid, alg: "RS256", use: "sig" },
    kid,
  };
}

async function signToken(
  privateKey: CryptoKey,
  kid: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    aud: [AUD],
    email: "Alice@Karkoai.com",
    exp: now + 600,
    iat: now,
    nbf: now,
    iss: TEAM,
    type: "app",
    identity_nonce: "6ei69kawdKzMIAPF",
    sub: "7335d417-61da-459d-899c-0a01c76a2f94",
    country: "US",
    ...overrides,
  };
  for (const [key, value] of Object.entries(payload)) {
    if (value === null) {
      delete payload[key];
    }
  }
  const header = b64urlJson({ alg: "RS256", kid, typ: "JWT" });
  const body = b64urlJson(payload);
  const data = new TextEncoder().encode(`${header}.${body}`);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, data);
  return `${header}.${body}.${b64urlBytes(signature)}`;
}

class Certs {
  calls = 0;
  fail = false;
  delayMs = 0;
  maxBytes: number | null = null;

  constructor(public keys: object[]) {}

  fetchJwks = async (): Promise<Response> => {
    this.calls += 1;
    if (this.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.fail) {
      return new Response("unavailable", { status: 503 });
    }
    const body = JSON.stringify({ keys: this.keys });
    if (this.maxBytes !== null && Buffer.byteLength(body) > this.maxBytes) {
      return new Response(body.slice(0, this.maxBytes), { status: 200 });
    }
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function verifier(certs: Certs, extra: Partial<AccessJwtVerifierOptions> = {}) {
  return new AccessJwtVerifier({
    teamDomain: TEAM,
    audience: AUD,
    fetchJwks: certs.fetchJwks,
    ...extra,
  });
}

describe("Access JWT verification", () => {
  it("yields the lowercased email for a valid user token", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    const identity = await verifier(certs).verify(await signToken(signing.privateKey, signing.kid));
    expect(identity).toEqual({ subject: "alice@karkoai.com", kind: "user" });
  });

  it("yields the common_name for a valid service token with empty sub", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    const identity = await verifier(certs).verify(
      await signToken(signing.privateKey, signing.kid, {
        email: null,
        identity_nonce: null,
        country: null,
        sub: "",
        common_name: "e367826f93b8d71185e03fe518aff3b4.access",
      }),
    );
    expect(identity).toEqual({
      subject: "e367826f93b8d71185e03fe518aff3b4.access",
      kind: "service_token",
    });
  });

  it("rejects a token signed by another key", async () => {
    const signing = await generateSigning();
    const attacker = await generateSigning("kid-1");
    const certs = new Certs([signing.jwk]);
    await expect(
      verifier(certs).verify(await signToken(attacker.privateKey, "kid-1")),
    ).rejects.toBeInstanceOf(AccessJwtError);
  });

  it("rejects HS256 algorithm confusion signed with the public key", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    const spki = await crypto.subtle.exportKey("spki", signing.publicKey);
    const pem =
      "-----BEGIN PUBLIC KEY-----\n" +
      Buffer.from(spki)
        .toString("base64")
        .match(/.{1,64}/g)
        ?.join("\n") +
      "\n-----END PUBLIC KEY-----\n";
    const now = Math.floor(Date.now() / 1000);
    const header = b64urlJson({ alg: "HS256", kid: "kid-1", typ: "JWT" });
    const payload = b64urlJson({
      aud: [AUD],
      email: "attacker@evil.test",
      exp: now + 600,
      iat: now,
      iss: TEAM,
      type: "app",
    });
    const signingInput = `${header}.${payload}`;
    const signature = createHmac("sha256", pem).update(signingInput).digest();
    const forged = `${signingInput}.${signature.toString("base64url")}`;
    await expect(verifier(certs).verify(forged)).rejects.toThrow(/not allowed/);
  });

  it("rejects an unsigned none algorithm token", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    const now = Math.floor(Date.now() / 1000);
    const forged = `${b64urlJson({ alg: "none", kid: "kid-1", typ: "JWT" })}.${b64urlJson({
      aud: [AUD],
      email: "attacker@evil.test",
      exp: now + 600,
      iat: now,
      iss: TEAM,
      type: "app",
    })}.`;
    await expect(verifier(certs).verify(forged)).rejects.toBeInstanceOf(AccessJwtError);
  });

  it("rejects a token for another application audience", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    await expect(
      verifier(certs).verify(
        await signToken(signing.privateKey, signing.kid, { aud: ["0".repeat(64)] }),
      ),
    ).rejects.toBeInstanceOf(AccessJwtError);
  });

  it("rejects a token from another team issuer", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    await expect(
      verifier(certs).verify(
        await signToken(signing.privateKey, signing.kid, {
          iss: "https://attacker.cloudflareaccess.com",
        }),
      ),
    ).rejects.toBeInstanceOf(AccessJwtError);
  });

  it("rejects an org session token", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    await expect(
      verifier(certs).verify(
        await signToken(signing.privateKey, signing.kid, { type: "org" }),
      ),
    ).rejects.toThrow(/not an application token/);
  });

  it("rejects an expired token past the leeway", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    const now = Math.floor(Date.now() / 1000);
    await expect(
      verifier(certs).verify(
        await signToken(signing.privateKey, signing.kid, {
          exp: now - 300,
          iat: now - 900,
        }),
      ),
    ).rejects.toBeInstanceOf(AccessJwtError);
  });

  it("rejects a token with no kid", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    const now = Math.floor(Date.now() / 1000);
    const header = b64urlJson({ alg: "RS256", typ: "JWT" });
    const payload = b64urlJson({
      aud: [AUD],
      email: "a@b.test",
      exp: now + 600,
      iat: now,
      iss: TEAM,
      type: "app",
    });
    const data = new TextEncoder().encode(`${header}.${payload}`);
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signing.privateKey, data);
    await expect(
      verifier(certs).verify(`${header}.${payload}.${b64urlBytes(signature)}`),
    ).rejects.toThrow(/no key id/);
  });

  it("rejects a token with neither email nor common_name", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    await expect(
      verifier(certs).verify(
        await signToken(signing.privateKey, signing.kid, {
          email: null,
          identity_nonce: null,
          country: null,
        }),
      ),
    ).rejects.toThrow(/neither email nor common_name/);
  });

  it.each(["", "   ", "not-a-jwt", "a.b"])(
    "rejects garbage %j without throwing a foreign error",
    async (token) => {
      const signing = await generateSigning();
      const certs = new Certs([signing.jwk]);
      await expect(verifier(certs).verify(token)).rejects.toBeInstanceOf(AccessJwtError);
    },
  );

  it("treats an unreachable key set as unavailable, not invalid", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    certs.fail = true;
    await expect(
      verifier(certs).verify(await signToken(signing.privateKey, signing.kid)),
    ).rejects.toBeInstanceOf(AccessJwtUnavailable);
  });

  it("treats an empty key set as unavailable", async () => {
    const signing = await generateSigning();
    const certs = new Certs([]);
    await expect(
      verifier(certs).verify(await signToken(signing.privateKey, signing.kid)),
    ).rejects.toBeInstanceOf(AccessJwtUnavailable);
  });

  it("caches keys across requests", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    const access = verifier(certs);
    for (let index = 0; index < 5; index += 1) {
      await access.verify(await signToken(signing.privateKey, signing.kid));
    }
    expect(certs.calls).toBe(1);
  });

  it("keeps usable keys when one JWKS entry is malformed", async () => {
    const signing = await generateSigning();
    const certs = new Certs([{ kid: "bad" }, signing.jwk]);
    const identity = await verifier(certs).verify(
      await signToken(signing.privateKey, signing.kid),
    );
    expect(identity.kind).toBe("user");
  });

  it("refuses a unicode lookalike before it can fold onto another identity", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    await expect(
      verifier(certs).verify(
        await signToken(signing.privateKey, signing.kid, {
          email: "\u212Aim@example.com",
        }),
      ),
    ).rejects.toThrow(/non-ASCII/);
  });

  it("rejects a service token whose common_name looks like an email", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    await expect(
      verifier(certs).verify(
        await signToken(signing.privateKey, signing.kid, {
          email: null,
          sub: "",
          common_name: "alice@example.com",
        }),
      ),
    ).rejects.toThrow(/email address/);
  });

  it("refuses an oversized token before parsing", async () => {
    const signing = await generateSigning();
    const certs = new Certs([signing.jwk]);
    await expect(verifier(certs).verify("a".repeat(8193))).rejects.toThrow(/exceeds/);
  });

  it("normalises team domain spellings to the issuer", () => {
    expect(normaliseTeamDomain("karkoai.cloudflareaccess.com")).toBe(TEAM);
    expect(normaliseTeamDomain("https://karkoai.cloudflareaccess.com/")).toBe(TEAM);
  });

  it("rejects a bad team domain at construction", () => {
    expect(() => normaliseTeamDomain("http://karkoai.cloudflareaccess.com")).toThrow(
      AccessConfigError,
    );
    expect(() =>
      new AccessJwtVerifier({
        teamDomain: TEAM,
        audience: "  ",
        fetchJwks: async () => new Response(),
      }),
    ).toThrow(AccessConfigError);
  });
});
