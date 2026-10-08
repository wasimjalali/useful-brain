import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import worker from "../src";
import { seedPersonas, seedPrincipals, type PersonaId } from "./seed";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function whoami(workerEnv: typeof env, cookie?: string) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new IncomingRequest("https://brain.internal/whoami", { headers: cookie ? { cookie } : {} }),
    workerEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

let cookies: Record<PersonaId, string>;
beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
});

describe("GET /whoami name and email", () => {
  const sessionEnv = {
    ...env,
    IDENTITY_MODE: "session",
    LOOPBACK_RUNTIME: "false",
    LOOPBACK_SUBJECT: "",
  } as typeof env;

  it("returns the account name and email for a session user", async () => {
    const body = (await (await whoami(sessionEnv, cookies["member-maya"])).json()) as {
      name: string | null;
      email: string | null;
    };
    expect(body.name).toBe("Maya Chen");
    expect(body.email).toBe("maya.chen@northwind.example");
  });

  it("returns null name and email for a loopback operator", async () => {
    const loopbackEnv = {
      ...env,
      IDENTITY_MODE: "loopback",
      LOOPBACK_RUNTIME: "true",
      LOOPBACK_SUBJECT: "dev@localhost",
    } as typeof env;
    const response = await whoami(loopbackEnv);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string | null; email: string | null };
    expect(body.name).toBeNull();
    expect(body.email).toBeNull();
  });
});
