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
};

describe("email/password sessions", () => {
  beforeEach(async () => {
    await seedPrincipals();
  });

  it("creates an account, signs in, and isolates whoami to that user", async () => {
    const signup = await fetchWorker(
      new IncomingRequest("https://brain.internal/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "wasim@example.com",
          password: "correct-horse",
        }),
      }),
      sessionEnv,
    );
    expect(signup.status).toBe(201);
    const created = (await signup.json()) as {
      user: { id: string; email: string };
      sessionToken: string;
    };
    expect(created.user.email).toBe("wasim@example.com");
    expect(created.sessionToken).toMatch(/^[0-9a-f]{64}$/);

    const whoami = await fetchWorker(
      new IncomingRequest("https://brain.internal/whoami", {
        headers: { cookie: `usefulbrain.session=${created.sessionToken}` },
      }),
      sessionEnv,
    );
    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toMatchObject({
      id: created.user.id,
      subject: "wasim@example.com",
      kind: "user",
      roles: [],
    });

    const denied = await fetchWorker(
      new IncomingRequest("https://brain.internal/whoami"),
      sessionEnv,
    );
    expect(denied.status).toBe(401);
  });

  it("rejects a wrong password and a duplicate email", async () => {
    const signup = await fetchWorker(
      new IncomingRequest("https://brain.internal/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dup@example.com", password: "correct-horse" }),
      }),
      sessionEnv,
    );
    expect(signup.status).toBe(201);

    const duplicate = await fetchWorker(
      new IncomingRequest("https://brain.internal/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dup@example.com", password: "correct-horse" }),
      }),
      sessionEnv,
    );
    expect(duplicate.status).toBe(400);

    const wrong = await fetchWorker(
      new IncomingRequest("https://brain.internal/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dup@example.com", password: "not-the-password" }),
      }),
      sessionEnv,
    );
    expect(wrong.status).toBe(401);

    const login = await fetchWorker(
      new IncomingRequest("https://brain.internal/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dup@example.com", password: "correct-horse" }),
      }),
      sessionEnv,
    );
    expect(login.status).toBe(200);
    const body = (await login.json()) as { sessionToken: string };
    expect(body.sessionToken).toMatch(/^[0-9a-f]{64}$/);
  });
});
