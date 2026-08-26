import { describe, expect, it } from "vitest";

import { AccessJwtVerifier } from "../../../src/lib/auth/access-jwt";
import { AUD, TEAM, generateSigning, jwksResponse, signToken } from "./jwt";

describe("Access JWT in workerd", () => {
  it("verifies with Web Crypto and cancels an oversized JWKS stream", async () => {
    const signing = await generateSigning();
    const verifier = new AccessJwtVerifier({
      teamDomain: TEAM,
      audience: AUD,
      fetchJwks: async () => jwksResponse([signing.jwk]),
    });
    const identity = await verifier.verify(await signToken(signing.privateKey, signing.kid));
    expect(identity).toEqual({ subject: "alice@karkoai.com", kind: "user" });

    let cancelled = false;
    const oversized = new AccessJwtVerifier({
      teamDomain: TEAM,
      audience: AUD,
      fetchJwks: async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('{"keys":['));
            controller.enqueue(new Uint8Array(300_000));
          },
          cancel() {
            cancelled = true;
          },
        });
        return new Response(stream, { status: 200 });
      },
    });
    await expect(oversized.verify(await signToken(signing.privateKey, signing.kid))).rejects.toThrow();
    expect(cancelled).toBe(true);
  });
});
