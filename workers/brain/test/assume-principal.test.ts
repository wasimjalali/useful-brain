import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";

import { LOOPBACK_ROLES } from "../../../src/lib/store/loopback-principal";
import worker from "../src";
import { generateSigning, jwksResponse, signToken } from "./jwt";
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
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/cdn-cgi/access/certs")) {
      return jwksResponse([signing.jwk]);
    }
    return originalFetch(input, init);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const loopbackEnv = {
  ...env,
  IDENTITY_MODE: "loopback",
  LOOPBACK_RUNTIME: "true",
  LOOPBACK_SUBJECT: "dev@localhost",
};

async function fetchWorker(request: Request, workerEnv: typeof env = env): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, workerEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function turnRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new IncomingRequest("https://brain.internal/turns", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const EVAL_PRINCIPAL = {
  userId: "eng_ic",
  roles: ["standard"],
  departments: ["engineering"],
};

describe("assumed retrieval principal on /turns", () => {
  it("fails closed on an assumed principal outside loopback identity mode", async () => {
    const token = await signToken(signing.privateKey, signing.kid);
    const response = await fetchWorker(
      turnRequest(
        {
          question: "What are the final pay rules?",
          requestId: "turn-assume-access",
          assumePrincipal: EVAL_PRINCIPAL,
        },
        { "cf-access-jwt-assertion": token },
      ),
    );
    expect(response.status).toBe(403);
  });

  it("rejects a malformed assumed principal in loopback mode", async () => {
    const missingGrants = await fetchWorker(
      turnRequest({
        question: "What are the final pay rules?",
        requestId: "turn-assume-invalid-1",
        assumePrincipal: { userId: "eng_ic" },
      }),
      loopbackEnv,
    );
    const emptyUser = await fetchWorker(
      turnRequest({
        question: "What are the final pay rules?",
        requestId: "turn-assume-invalid-2",
        assumePrincipal: { userId: "  ", roles: [], departments: [] },
      }),
      loopbackEnv,
    );
    const nonStringRole = await fetchWorker(
      turnRequest({
        question: "What are the final pay rules?",
        requestId: "turn-assume-invalid-3",
        assumePrincipal: { userId: "eng_ic", roles: [42], departments: [] },
      }),
      loopbackEnv,
    );
    expect(missingGrants.status).toBe(400);
    expect(emptyUser.status).toBe(400);
    expect(nonStringRole.status).toBe(400);
  });

  it("accepts a valid assumed principal in loopback mode and echoes it", async () => {
    const response = await fetchWorker(
      turnRequest({
        question: "What are the final pay rules?",
        requestId: "turn-assume-valid",
        assumePrincipal: EVAL_PRINCIPAL,
        persistConversation: false,
      }),
      loopbackEnv,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      assumedPrincipal?: typeof EVAL_PRINCIPAL;
      structuredAnswer: { answerType: string };
    };
    expect(body.assumedPrincipal).toEqual(EVAL_PRINCIPAL);
    expect(body.structuredAnswer.answerType).toBe("insufficient_evidence");
  });

  it("gives the loopback operator the declared operator-read roles", async () => {
    const response = await fetchWorker(
      new IncomingRequest("https://brain.internal/whoami"),
      loopbackEnv,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { roles: string[] };
    for (const role of LOOPBACK_ROLES) {
      expect(body.roles).toContain(role);
    }
    expect(LOOPBACK_ROLES).toContain("hr_manager");
    expect(LOOPBACK_ROLES).toContain("director");
  });
});
