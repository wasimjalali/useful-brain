import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";

import { CHAT_MODEL_ID } from "../../../src/lib/models/selection";
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

describe("eval-only chat model override on /turns", () => {
  it("fails closed on evalModel outside loopback identity mode", async () => {
    const token = await signToken(signing.privateKey, signing.kid);
    const response = await fetchWorker(
      turnRequest(
        {
          question: "What are the final pay rules?",
          requestId: "turn-eval-model-access",
          evalModel: CHAT_MODEL_ID,
        },
        { "cf-access-jwt-assertion": token },
      ),
    );
    expect(response.status).toBe(403);
  });

  it("rejects an unapproved model id in loopback mode", async () => {
    const unapproved = await fetchWorker(
      turnRequest({
        question: "What are the final pay rules?",
        requestId: "turn-eval-model-invalid-1",
        evalModel: "@cf/openai/gpt-oss-120b",
      }),
      loopbackEnv,
    );
    const nonString = await fetchWorker(
      turnRequest({
        question: "What are the final pay rules?",
        requestId: "turn-eval-model-invalid-2",
        evalModel: 42,
      }),
      loopbackEnv,
    );
    expect(unapproved.status).toBe(400);
    expect(nonString.status).toBe(400);
  });

  it("accepts an approved candidate in loopback mode", async () => {
    // The workerd test env has no AI binding, so the turn answers on the
    // faux provider; which model actually answered is verified fail-closed
    // by the live eval harness against the response's answerModel.
    const response = await fetchWorker(
      turnRequest({
        question: "What are the final pay rules?",
        requestId: "turn-eval-model-valid",
        persistConversation: false,
        evalModel: "@cf/google/gemma-4-26b-a4b-it",
      }),
      loopbackEnv,
    );
    expect(response.status).toBe(200);
  });
});
