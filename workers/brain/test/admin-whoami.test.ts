import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import worker from "../src";
import { aclFilterFor, countReadableDocuments } from "../../../src/lib/acl/access";
import { loadKnowledgeInventory } from "../../../src/lib/store/knowledge-inventory";
import {
  CORPUS_DOCUMENT_IDS,
  EXPECTED_READABLE,
  seedCorpus,
  seedPersonas,
  seedPrincipals,
  seedSessionUser,
  type PersonaId,
} from "./seed";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const sessionEnv = {
  ...env,
  IDENTITY_MODE: "session",
  LOOPBACK_RUNTIME: "false",
  LOOPBACK_SUBJECT: "",
};

async function call(path: string, cookie?: string, workerEnv: typeof env = sessionEnv, method = "GET") {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new IncomingRequest(`https://brain.internal${path}`, {
      method,
      headers: cookie ? { cookie } : {},
    }),
    workerEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

type Whoami = {
  id: string;
  kind: string;
  subject: string;
  roles: string[];
  departments: string[];
  isAdmin: boolean;
  department: string | null;
  readableDocumentCount: number;
};

let cookies: Record<PersonaId, string>;
let generationId: string;

beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
  generationId = (await seedCorpus()).generationId;
});

describe("admin gate", () => {
  for (const path of ["/config", "/admin/anything"]) {
    it(`${path}: no cookie is 401, a member is 403`, async () => {
      expect((await call(path)).status).toBe(401);
      expect((await call(path, cookies["member-maya"])).status).toBe(403);
      expect((await call(path, cookies["member-priya"])).status).toBe(403);
    });
  }

  it("admin passes the gate: /config is 200, an unrouted /admin path reaches the router 404", async () => {
    expect((await call("/config", cookies["member-jordan"])).status).toBe(200);
    expect((await call("/admin/anything", cookies["member-jordan"])).status).toBe(404);
  });

  it("denies role strings that only look like admin", async () => {
    for (const [index, role] of ["Admin", "admin ", "ADMIN", " admin"].entries()) {
      const cookie = await seedSessionUser({
        id: `member-lookalike-${index}`,
        email: `lookalike${index}@northwind.example`,
        name: "Lookalike",
        roles: [role],
        departments: ["operations"],
      });
      expect((await call("/config", cookie)).status).toBe(403);
      expect((await call("/admin/anything", cookie)).status).toBe(403);
      const whoami = (await (await call("/whoami", cookie)).json()) as Whoami;
      expect(whoami.isAdmin).toBe(false);
    }
  });

  it("admin grants no document read rights", async () => {
    const whoami = (await (await call("/whoami", cookies["member-jordan"])).json()) as Whoami;
    expect(whoami.isAdmin).toBe(true);
    expect(whoami.readableDocumentCount).toBe(EXPECTED_READABLE["member-jordan"]);
    expect(whoami.readableDocumentCount).toBeLessThan(CORPUS_DOCUMENT_IDS.length);
  });

  it("POST /evaluations/run refuses a member before running anything", async () => {
    expect((await call("/evaluations/run", cookies["member-maya"], sessionEnv, "POST")).status).toBe(403);
  });

  it("keeps /knowledge/* operator-gated for members", async () => {
    expect((await call("/knowledge/reindex", cookies["member-maya"], sessionEnv, "POST")).status).toBe(403);
  });
});

describe("GET /config", () => {
  it("reports models, retrieval profile, generation and connectors without secrets", async () => {
    const response = await call("/config", cookies["member-jordan"]);
    const body = (await response.json()) as {
      models: { answer: string; embedding: string; reranker: string };
      retrieval: { mode: string; passages: number; rerankFloor: number; configVersion: string };
      activeGenerationId: string | null;
      connectors: Array<{ id: string; kind: string; approval: boolean; status: string }>;
    };
    expect(body.models).toEqual({
      answer: "@cf/zai-org/glm-5.3-flash",
      embedding: "@cf/qwen/qwen3-embedding-0.6b",
      reranker: "@cf/baai/bge-reranker-base",
    });
    expect(body.retrieval).toMatchObject({ mode: "keyword", passages: 8, rerankFloor: 0.05 });
    expect(body.retrieval.configVersion).toContain("real-stack");
    expect(body.activeGenerationId).toBe(generationId);
    expect(body.connectors.some((c) => c.kind === "upload")).toBe(true);
    expect(body.connectors.find((c) => c.id === "tool-send_email")).toMatchObject({
      kind: "action",
      approval: true,
    });
    expect(body.connectors.some((c) => c.id === "tool-search_knowledge")).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/doc-|secret|token/i);
  });
});

describe("whoami", () => {
  for (const persona of ["member-maya", "member-priya", "member-jordan"] as const) {
    it(`${persona}: fields and readable count equal the canAccessChunk oracle`, async () => {
      const whoami = (await (await call("/whoami", cookies[persona])).json()) as Whoami;
      expect(whoami.id).toBe(persona);
      expect(whoami.kind).toBe("user");
      expect(whoami.department).toBe(whoami.departments[0]);
      expect(whoami.readableDocumentCount).toBe(EXPECTED_READABLE[persona]);
      const principal = {
        userId: whoami.id,
        roles: whoami.roles,
        departments: whoami.departments,
      };
      const oracle = await loadKnowledgeInventory(env.CORPUS_DB, "keyword", principal);
      expect(whoami.readableDocumentCount).toBe(oracle.documents.length);
      expect(await countReadableDocuments(env.CORPUS_DB, generationId, principal)).toBe(
        oracle.documents.length,
      );
      expect(whoami.readableDocumentCount).toBeLessThan(CORPUS_DOCUMENT_IDS.length);
      expect(() => aclFilterFor(principal)).not.toThrow();
    });
  }

  it("a user with no roles or departments reads only public documents", async () => {
    const cookie = await seedSessionUser({
      id: "member-nobody",
      email: "nobody@northwind.example",
      name: "Nobody",
      roles: [],
      departments: [],
    });
    const whoami = (await (await call("/whoami", cookie)).json()) as Whoami;
    expect(whoami.department).toBeNull();
    expect(whoami.readableDocumentCount).toBe(2);
  });

  it("reports 0 when there is no active generation", async () => {
    const empty = {
      ...sessionEnv,
      CORPUS_DB: {
        prepare() {
          const statement = {
            bind: () => statement,
            first: async () => ({ active_generation_id: null }),
          };
          return statement;
        },
      },
    } as unknown as typeof env;
    const whoami = (await (await call("/whoami", cookies["member-maya"], empty)).json()) as Whoami;
    expect(whoami.readableDocumentCount).toBe(0);
  });
});
