import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import worker from "../src";
import { sha256Hex } from "../../../src/lib/ingest/digests";
import { verifyPassword } from "../../../src/lib/auth/password";
import { seedPersonas, seedPrincipals, type PersonaId } from "./seed";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const sessionEnv = { ...env, IDENTITY_MODE: "session", LOOPBACK_RUNTIME: "false", LOOPBACK_SUBJECT: "" };

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new IncomingRequest(`https://brain.internal${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    sessionEnv,
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

async function issue(email: string, role = "manager", department = "finance") {
  const response = await post("/admin/invites", { email, role, department }, cookies["member-jordan"]);
  expect(response.status).toBe(201);
  const body = (await response.json()) as { url: string; expiresAt: number };
  const token = new URL(body.url, "https://app.example").searchParams.get("token") ?? body.url.split("/").pop()!;
  return { ...body, token };
}

describe("POST /admin/invites authz and validation", () => {
  const valid = { email: "new.hire@northwind.example", role: "manager", department: "finance" };

  it("needs a session and refuses members", async () => {
    expect((await post("/admin/invites", valid)).status).toBe(401);
    expect((await post("/admin/invites", valid, cookies["member-maya"])).status).toBe(403);
  });

  it("rejects the admin role outright, however it is spelled", async () => {
    for (const role of ["admin", "Admin", " admin", "operator", "root"]) {
      const response = await post("/admin/invites", { ...valid, email: `x${role.length}@northwind.example`, role }, cookies["member-jordan"]);
      expect(response.status, role).toBe(400);
    }
    const stored = await env.OPERATIONS_DB.prepare(`SELECT COUNT(*) AS n FROM invites WHERE role LIKE '%dmin%'`).first<{ n: number }>();
    expect(stored?.n).toBe(0);
  });

  it("rejects unknown departments, bad emails and bad bodies", async () => {
    for (const body of [
      { ...valid, department: "marketing" },
      { ...valid, email: "not-an-email" },
      { ...valid, role: 5 },
      { email: valid.email },
    ]) {
      expect((await post("/admin/invites", body, cookies["member-jordan"])).status).toBe(400);
    }
  });

  it("stores only the sha256 of the token and expires in 7 days", async () => {
    const before = Date.now();
    const invite = await issue("hash.check@northwind.example");
    expect(invite.expiresAt - before).toBeGreaterThanOrEqual(7 * 86_400_000 - 5000);
    expect(invite.expiresAt - before).toBeLessThanOrEqual(7 * 86_400_000 + 5000);
    const row = await env.OPERATIONS_DB.prepare(`SELECT token_hash FROM invites WHERE email = ?`)
      .bind("hash.check@northwind.example").first<{ token_hash: string }>();
    expect(row?.token_hash).toBe(await sha256Hex(invite.token));
    expect(invite.url).not.toContain(row!.token_hash);
  });

  it("allows one open invite per email and refuses an email that already has an account", async () => {
    await issue("dupe@northwind.example");
    expect((await post("/admin/invites", { email: "dupe@northwind.example", role: "manager", department: "finance" }, cookies["member-jordan"])).status).toBe(400);
    expect((await post("/admin/invites", { email: "maya.chen@northwind.example", role: "manager", department: "finance" }, cookies["member-jordan"])).status).toBe(400);
  });
});

describe("POST /admin/invites typed reasons", () => {
  const valid = { role: "manager", department: "finance" };
  const reasonOf = async (body: unknown) => {
    const response = await post("/admin/invites", body, cookies["member-jordan"]);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { code: string; reason?: string };
    expect(json.code).toBe("VALIDATION_FAILED");
    return json.reason;
  };

  it("names the rejection with a stable reason", async () => {
    expect(await reasonOf({ ...valid, email: "not-an-email" })).toBe("invalid_email");
    expect(await reasonOf({ ...valid, email: 7 })).toBe("invalid_email");
    expect(await reasonOf({ ...valid, email: "r1@northwind.example", role: "admin" })).toBe("invalid_role");
    expect(await reasonOf({ ...valid, email: "r2@northwind.example", department: "marketing" })).toBe("invalid_department");
    expect(await reasonOf({ ...valid, email: "maya.chen@northwind.example" })).toBe("account_exists");
    await issue("reason.open@northwind.example");
    expect(await reasonOf({ ...valid, email: "reason.open@northwind.example" })).toBe("invite_open");
  });

  it("keeps the message generic", async () => {
    const response = await post("/admin/invites", { ...valid, email: "maya.chen@northwind.example" }, cookies["member-jordan"]);
    const json = (await response.json()) as { message: string };
    expect(json.message).toBe("That email is already registered.");
  });
});

describe("POST /auth/invite/accept", () => {
  const generic = async (response: Response) => response.status === 400 ? await response.text() : `status ${response.status}`;

  it("creates exactly the invited grants plus a working session, once", async () => {
    const invite = await issue("accept.ok@northwind.example", "finance_manager", "finance");
    const response = await post("/auth/invite/accept", { token: invite.token, name: "Accept Ok", password: "correct horse battery" });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { user: { id: string; email: string }; sessionToken: string };
    expect(body.user.email).toBe("accept.ok@northwind.example");
    const db = env.OPERATIONS_DB;
    const roles = await db.prepare(`SELECT role FROM roles WHERE principal_id = ?`).bind(body.user.id).all<{ role: string }>();
    const departments = await db.prepare(`SELECT department FROM departments WHERE principal_id = ?`).bind(body.user.id).all<{ department: string }>();
    expect(roles.results.map((r) => r.role)).toEqual(["finance_manager"]);
    expect(departments.results.map((d) => d.department)).toEqual(["finance"]);
    const user = await db.prepare(`SELECT password_hash FROM auth_users WHERE id = ?`).bind(body.user.id).first<{ password_hash: string }>();
    expect(await verifyPassword("correct horse battery", user!.password_hash)).toBe(true);
    const whoami = await worker.fetch(
      new IncomingRequest("https://brain.internal/whoami", { headers: { cookie: `usefulbrain.session=${body.sessionToken}` } }),
      sessionEnv,
      createExecutionContext(),
    );
    const me = (await whoami.json()) as { roles: string[]; departments: string[]; isAdmin: boolean };
    expect(me).toMatchObject({ roles: ["finance_manager"], departments: ["finance"], isAdmin: false });
  });

  it("replay gives the same generic error as unknown and expired tokens", async () => {
    const invite = await issue("replay@northwind.example");
    const first = await post("/auth/invite/accept", { token: invite.token, name: "Re Play", password: "correct horse battery" });
    expect(first.status).toBe(201);
    const replay = await generic(await post("/auth/invite/accept", { token: invite.token, name: "Re Play", password: "another password 1" }));

    const expired = await issue("expired@northwind.example");
    await env.OPERATIONS_DB.prepare(`UPDATE invites SET expires_at = ? WHERE email = ?`).bind(Date.now() - 1000, "expired@northwind.example").run();
    const expiredBody = await generic(await post("/auth/invite/accept", { token: expired.token, name: "Ex Pired", password: "correct horse battery" }));
    const unknown = await generic(await post("/auth/invite/accept", { token: "0".repeat(64), name: "Un Known", password: "correct horse battery" }));

    const strip = (text: string) => text.replace(/"requestId":"[^"]*"/, "");
    expect(replay).not.toMatch(/^status/);
    expect(strip(expiredBody)).toBe(strip(replay));
    expect(strip(unknown)).toBe(strip(replay));
    const account = await env.OPERATIONS_DB.prepare(`SELECT COUNT(*) AS n FROM auth_users WHERE email = 'expired@northwind.example'`).first<{ n: number }>();
    expect(account?.n).toBe(0);
  });

  it("two concurrent accepts of one token create exactly one account", async () => {
    const invite = await issue("race@northwind.example");
    const results = await Promise.all([
      post("/auth/invite/accept", { token: invite.token, name: "Race One", password: "correct horse battery" }),
      post("/auth/invite/accept", { token: invite.token, name: "Race Two", password: "correct horse battery" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    const n = await env.OPERATIONS_DB.prepare(`SELECT COUNT(*) AS n FROM auth_users WHERE email = 'race@northwind.example'`).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("a weak password does not burn the invite", async () => {
    const invite = await issue("weak@northwind.example");
    expect((await post("/auth/invite/accept", { token: invite.token, name: "Weak", password: "short" })).status).toBe(400);
    expect((await post("/auth/invite/accept", { token: invite.token, name: "Weak", password: "correct horse battery" })).status).toBe(201);
  });

  it("rejects malformed bodies and rate-limits repeated bad tries on one token", async () => {
    expect((await post("/auth/invite/accept", { name: "x", password: "correct horse battery" })).status).toBe(400);
    expect((await post("/auth/invite/accept", { token: 5, name: "x", password: "correct horse battery" })).status).toBe(400);
    const token = "f".repeat(64);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push((await post("/auth/invite/accept", { token, name: "Brute", password: "correct horse battery" })).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses[6]).toBe(429);
  });

  it("is reachable without a session", async () => {
    expect((await post("/auth/invite/accept", { token: "a".repeat(64), name: "x", password: "correct horse battery" })).status).not.toBe(401);
  });
});
