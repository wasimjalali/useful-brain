import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import worker from "../src";
import { countReadableDocuments } from "../../../src/lib/acl/access";
import type { GroupsResponse, PeopleResponse } from "../../../src/lib/contracts/people";
import { CORPUS_DOCUMENT_IDS, EXPECTED_READABLE, seedCorpus, seedPersonas, seedPrincipals, seedSessionUser, type PersonaId } from "./seed";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const sessionEnv = { ...env, IDENTITY_MODE: "session", LOOPBACK_RUNTIME: "false", LOOPBACK_SUBJECT: "" };

async function get(path: string, cookie?: string): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new IncomingRequest(`https://brain.internal${path}`, { headers: cookie ? { cookie } : {} }),
    sessionEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

let cookies: Record<PersonaId, string>;
let generationId: string;
beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
  generationId = (await seedCorpus()).generationId;
});

describe("authz", () => {
  for (const path of ["/admin/people", "/admin/groups"]) {
    it(`${path}: 401 without a session, 403 for members`, async () => {
      expect((await get(path)).status).toBe(401);
      expect((await get(path, cookies["member-maya"])).status).toBe(403);
      expect((await get(path, cookies["member-priya"])).status).toBe(403);
      expect((await get(path, cookies["member-jordan"])).status).toBe(200);
    });
  }
});

describe("GET /admin/people", () => {
  it("lists roles as admin or member, with department and last active", async () => {
    const body = (await (await get("/admin/people", cookies["member-jordan"])).json()) as PeopleResponse;
    const byEmail = new Map(body.people.map((p) => [p.email, p]));
    expect(byEmail.get("jordan.ellis@northwind.example")).toMatchObject({ name: "Jordan Ellis", role: "admin", department: "operations" });
    expect(byEmail.get("maya.chen@northwind.example")).toMatchObject({ role: "member", department: "engineering" });
    expect(typeof byEmail.get("maya.chen@northwind.example")!.lastActive).toBe("number");
    expect(body.activeDocuments).toBe(CORPUS_DOCUMENT_IDS.length);
  });

  it("readable counts equal the whoami counts per persona", async () => {
    const body = (await (await get("/admin/people", cookies["member-jordan"])).json()) as PeopleResponse;
    for (const persona of ["member-maya", "member-priya", "member-jordan"] as const) {
      const whoami = (await (await get("/whoami", cookies[persona])).json()) as { readableDocumentCount: number };
      const person = body.people.find((p) => p.id === persona)!;
      expect(person.readableDocuments).toBe(whoami.readableDocumentCount);
      expect(person.readableDocuments).toBe(EXPECTED_READABLE[persona]);
    }
  });

  it("admin grants no read rights in the count, and a private owner counts their own document", async () => {
    const body = (await (await get("/admin/people", cookies["member-jordan"])).json()) as PeopleResponse;
    const jordan = body.people.find((p) => p.id === "member-jordan")!;
    const direct = await countReadableDocuments(env.CORPUS_DB, generationId, { userId: "member-jordan", roles: ["admin"], departments: ["operations"] });
    expect(jordan.readableDocuments).toBe(direct);
  });

  it("caps the list at 200 but reports the true total", async () => {
    for (let i = 0; i < 205; i += 1) {
      await seedSessionUser({ id: `bulk-${i}`, email: `bulk${i}@northwind.example`, name: `Bulk ${i}`, roles: ["standard"], departments: ["sales"] });
    }
    const body = (await (await get("/admin/people", cookies["member-jordan"])).json()) as PeopleResponse;
    expect(body.people.length).toBe(200);
    expect(body.total).toBeGreaterThanOrEqual(208);
  }, 60_000);
});

describe("GET /admin/groups", () => {
  it("returns Everyone, departments and roles with counts, rules and document deltas", async () => {
    const body = (await (await get("/admin/groups", cookies["member-jordan"])).json()) as GroupsResponse;
    const group = (id: string) => body.groups.find((g) => g.id === id)!;
    expect(group("everyone")).toMatchObject({ type: "built_in", rule: "all members", addsDocuments: 2 });
    expect(group("department:engineering")).toMatchObject({ type: "department", rule: "department = engineering", addsDocuments: 1 });
    expect(group("department:support").addsDocuments).toBe(1);
    expect(group("department:legal").addsDocuments).toBe(0);
    expect(group("role:finance_manager")).toMatchObject({ type: "role", rule: "role = finance_manager", addsDocuments: 1 });
    expect(group("role:manager").addsDocuments).toBe(1);
    expect(group("department:engineering").people).toBeGreaterThanOrEqual(1);
    expect(group("everyone").people).toBeGreaterThanOrEqual(3);
  });
});
