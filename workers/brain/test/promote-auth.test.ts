import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import worker from "../src";
import { seedPrincipals } from "./seed";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function fetchWorker(request: Request, workerEnv: typeof env = env): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, workerEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

const sessionEnv = {
  ...env,
  IDENTITY_MODE: "session",
  LOOPBACK_RUNTIME: "false",
  LOOPBACK_SUBJECT: "",
  SIGNUP_CODE: "test-signup-code",
};

type Signup = { user: { id: string }; sessionToken: string };

async function signup(email: string): Promise<Signup> {
  const response = await fetchWorker(
    new IncomingRequest("https://brain.internal/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse", signupCode: "test-signup-code" }),
    }),
    sessionEnv,
  );
  expect(response.status).toBe(201);
  return (await response.json()) as Signup;
}

describe("knowledge promote authorization", () => {
  beforeEach(async () => {
    await seedPrincipals();
  });

  it("forbids a session user from promoting a nonexistent or foreign generation", async () => {
    const account = await signup("promo-user@example.com");
    const missing = await fetchWorker(
      new IncomingRequest("https://brain.internal/knowledge/promote", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `usefulbrain.session=${account.sessionToken}`,
        },
        body: JSON.stringify({ generationId: "g-missing" }),
      }),
      sessionEnv,
    );
    expect(missing.status).toBe(400);
    const foreign = await fetchWorker(
      new IncomingRequest("https://brain.internal/knowledge/promote", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `usefulbrain.session=${account.sessionToken}`,
        },
        body: JSON.stringify({ generationId: "g-1" }),
      }),
      {
        ...sessionEnv,
        CORPUS_DB: {
          prepare() {
            const statement = {
              bind() {
                return statement;
              },
              async first() {
                return { id: "g-1", state: "ready" };
              },
              async all() {
                return {
                  results: [
                    {
                      document_id: "upl-p-other-nw_test",
                      path: "users/p-other/nw_test.md",
                      content: "body",
                      chunk_index: 0,
                      access_scope: "private",
                      allowed_roles: "[]",
                      allowed_departments: "[]",
                      metadata: JSON.stringify({ owner_user_id: "p-other" }),
                    },
                  ],
                };
              },
              async run() {
                return { meta: { changes: 0 } };
              },
            };
            return statement;
          },
          async batch() {
            return [];
          },
        },
      },
    );
    expect(foreign.status).toBe(403);
  });
});
