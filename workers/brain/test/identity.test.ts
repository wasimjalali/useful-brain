import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createBrainBoundRequest } from "../../../src/lib/cf/service-binding-identity";
import { createPendingTurn } from "../../../src/lib/store/conversations";
import worker from "../src";
import { AUD, generateSigning, jwksResponse, signToken } from "./jwt";
import { seedPrincipals } from "./seed";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

let originalFetch: typeof fetch;
let signing: Awaited<ReturnType<typeof generateSigning>>;

beforeAll(async () => {
  signing = await generateSigning();
});

beforeEach(async () => {
  await seedPrincipals();
  originalFetch = globalThis.fetch;
  mockJwks([signing.jwk]);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockJwks(keys: object[]): void {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/cdn-cgi/access/certs")) {
      return jwksResponse(keys);
    }
    return originalFetch(input, init);
  };
}

async function fetchWorker(request: Request, workerEnv: typeof env = env): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, workerEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("Web-to-Brain identity", () => {
  it("forwards only the Access assertion over the Service Binding and resolves directory grants", async () => {
    const token = await signToken(signing.privateKey, signing.kid);
    const response = await exports.default.fetch(
      createBrainBoundRequest(
        new IncomingRequest("https://web.example/whoami", {
          headers: {
            "cf-access-jwt-assertion": token,
            "x-useful-brain-principal": "spoofed@evil.example",
            "cf-access-authenticated-user-email": "spoofed@evil.example",
          },
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "principal-alice",
      kind: "user",
      subject: "alice@karkoai.com",
      roles: ["operator"],
      departments: ["engineering"],
    });
  });

  it("rejects a spoofed principal when Brain is called directly", async () => {
    const token = await signToken(signing.privateKey, signing.kid);
    const response = await fetchWorker(
      new IncomingRequest("https://brain.internal/whoami", {
        headers: {
          "cf-access-jwt-assertion": token,
          "x-useful-brain-principal": "spoofed@evil.example",
        },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("fails closed for missing, forged, expired and wrong-audience assertions", async () => {
    const valid = await signToken(signing.privateKey, signing.kid);
    const expired = await signToken(signing.privateKey, signing.kid, {
      exp: Math.floor(Date.now() / 1000) - 120,
      nbf: Math.floor(Date.now() / 1000) - 240,
    });
    const wrongAud = await signToken(signing.privateKey, signing.kid, { aud: ["other-audience"] });

    const missing = await fetchWorker(new IncomingRequest("https://brain.internal/whoami"));
    const forged = await fetchWorker(
      new IncomingRequest("https://brain.internal/whoami", {
        headers: { "cf-access-jwt-assertion": `${valid.slice(0, -4)}abcd` },
      }),
    );
    const expiredResponse = await fetchWorker(
      new IncomingRequest("https://brain.internal/whoami", {
        headers: { "cf-access-jwt-assertion": expired },
      }),
    );
    const wrongAudience = await fetchWorker(
      new IncomingRequest("https://brain.internal/whoami", {
        headers: { "cf-access-jwt-assertion": wrongAud },
      }),
    );

    expect(missing.status).toBe(401);
    expect(forged.status).toBe(401);
    expect(expiredResponse.status).toBe(401);
    expect(wrongAudience.status).toBe(401);
    expect(AUD).toHaveLength(64);
  });

  it("does not treat caller-controlled loopback headers as identity", async () => {
    const loopbackEnv = {
      ...env,
      IDENTITY_MODE: "loopback",
      LOOPBACK_RUNTIME: "true",
      LOOPBACK_SUBJECT: "dev@localhost",
    };
    const response = await fetchWorker(
      new IncomingRequest("https://brain.internal/whoami", {
        headers: {
          "x-forwarded-for": "203.0.113.8",
          "cf-connecting-ip": "203.0.113.8",
        },
      }),
      loopbackEnv,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "principal-dev", kind: "user" });
  });

  it("serves health and fails closed on whoami in staging disabled identity", async () => {
    const disabledStaging = {
      ...env,
      RUNTIME_ENV: "staging",
      IDENTITY_MODE: "disabled",
      RESOURCES_PROVISIONED: "true",
      LOOPBACK_RUNTIME: "false",
      LOOPBACK_SUBJECT: "",
    };
    const health = await fetchWorker(
      new IncomingRequest("https://brain.internal/health"),
      disabledStaging,
    );
    const whoami = await fetchWorker(
      new IncomingRequest("https://brain.internal/whoami"),
      disabledStaging,
    );
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");
    expect(whoami.status).toBe(500);
    expect(await whoami.json()).toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("fails startup when loopback is enabled without the trusted runtime signal", async () => {
    const response = await fetchWorker(
      new IncomingRequest("https://brain.internal/whoami"),
      {
        ...env,
        IDENTITY_MODE: "loopback",
        LOOPBACK_RUNTIME: "false",
        LOOPBACK_SUBJECT: "dev@localhost",
      },
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("INTERNAL_ERROR");
  });

  it("maps malformed lock JSON to validation failure", async () => {
    const token = await signToken(signing.privateKey, signing.kid);
    const response = await fetchWorker(
      new IncomingRequest("https://brain.internal/lock", {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": token,
          "content-type": "application/json",
        },
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("forbids stream, lock and approval routes for another conversation owner", async () => {
    const token = await signToken(signing.privateKey, signing.kid);
    const pending = await createPendingTurn(env.OPERATIONS_DB, {
      ownerPrincipalId: "principal-dev",
      requestId: "req-route-owner",
      question: "Private",
      now: 100,
    });
    const headers = {
      "cf-access-jwt-assertion": token,
      "content-type": "application/json",
    };
    const lock = await fetchWorker(
      new IncomingRequest("https://brain.internal/lock", {
        method: "POST",
        headers,
        body: JSON.stringify({ conversationId: pending.conversationId, runId: "run-owner-test" }),
      }),
    );
    expect(lock.status).toBe(403);

    const stream = await fetchWorker(
      new IncomingRequest(
        `https://brain.internal/stream?conversationId=${pending.conversationId}`,
        { headers: { "cf-access-jwt-assertion": token, Upgrade: "websocket" } },
      ),
    );
    expect(stream.status).toBe(403);

    const binding = {
      principalId: "principal-alice",
      conversationId: pending.conversationId,
      tool: "create_draft",
      argumentFingerprint: '{"title":"private"}',
      idempotencyKey: "draft-private",
      expiresAt: Date.now() + 60_000,
    };
    const approval = await fetchWorker(
      new IncomingRequest("https://brain.internal/approvals/event", {
        method: "POST",
        headers,
        body: JSON.stringify({
          workflowId: binding.idempotencyKey,
          decision: "approve",
          binding,
        }),
      }),
    );
    expect(approval.status).toBe(403);
  });
});
