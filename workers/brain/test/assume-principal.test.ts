import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";

import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

import { runViewAsTurn } from "../../../src/lib/brain/view-as-turn";
import type { OperationsDatabase } from "../../../src/lib/store/conversations";
import { LOOPBACK_ROLES } from "../../../src/lib/store/loopback-principal";
import worker from "../src";
import { call, seedChatCorpus } from "./chat-helpers";
import { generateSigning, jwksResponse, signToken } from "./jwt";
import { EXPECTED_READABLE, seedPersonas, seedPrincipals, type PersonaId } from "./seed";

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

describe("view as another person (assumePrincipalId)", () => {
  let cookies: Record<PersonaId, string>;

  beforeAll(async () => {
    await seedPrincipals();
    cookies = await seedPersonas();
    await seedChatCorpus();
  });

  const total = async (table: string) =>
    Number(
      (await env.OPERATIONS_DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0,
    );

  const audit = (requestId: string) =>
    env.OPERATIONS_DB.prepare(
      `SELECT admin_principal_id, assumed_principal_id, question_sha256, answer_type, diagnostic_shown
       FROM view_as_audits WHERE request_id = ?`,
    )
      .bind(requestId)
      .first<{
        admin_principal_id: string;
        assumed_principal_id: string;
        question_sha256: string;
        answer_type: string | null;
        diagnostic_shown: number;
      }>();

  const asPriya = (cookie: string, requestId: string, extra: Record<string, unknown> = {}) =>
    call("/turns", cookie, {
      json: { question: "What are the final pay rules?", requestId, assumePrincipalId: "member-priya", ...extra },
    });

  it("refuses a non-admin before looking the person up", async () => {
    const real = await asPriya(cookies["member-maya"], "va-nonadmin-1");
    const unknown = await call("/turns", cookies["member-maya"], {
      json: { question: "Hello there", requestId: "va-nonadmin-2", assumePrincipalId: "no-such-person" },
    });
    expect(real.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(await audit("va-nonadmin-1")).toBeNull();
  });

  it("is forbidden outside loopback and session identity modes", async () => {
    const token = await signToken(signing.privateKey, signing.kid);
    const response = await fetchWorker(
      turnRequest(
        { question: "Hello there", requestId: "va-access", assumePrincipalId: "member-priya" },
        { "cf-access-jwt-assertion": token },
      ),
    );
    expect(response.status).toBe(403);
  });

  it("is NOT_FOUND for an unknown id and for a service token", async () => {
    const unknown = await call("/turns", cookies["member-jordan"], {
      json: { question: "Hello there", requestId: "va-unknown", assumePrincipalId: "no-such-person" },
    });
    const bot = await call("/turns", cookies["member-jordan"], {
      json: { question: "Hello there", requestId: "va-bot", assumePrincipalId: "principal-bot" },
    });
    expect(unknown.status).toBe(404);
    expect(bot.status).toBe(404);
    expect(await audit("va-unknown")).toBeNull();
  });

  it("rejects a malformed id", async () => {
    const response = await call("/turns", cookies["member-jordan"], {
      json: { question: "Hello there", requestId: "va-bad", assumePrincipalId: 7 },
    });
    expect(response.status).toBe(400);
  });

  it("answers as the person, echoes only the public card, and stores nothing", async () => {
    const before = {
      conversations: await total("conversations"),
      messages: await total("messages"),
      steps: await total("turn_steps"),
    };
    const response = await asPriya(cookies["member-jordan"], "va-success");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.assumedPerson).toEqual({
      id: "member-priya",
      displayName: "Priya Shah",
      department: "support",
      // Priya's 3 seeded documents plus the 7 public Northwind documents.
      readableDocuments: EXPECTED_READABLE["member-priya"] + 7,
    });
    expect(body).not.toHaveProperty("assumedPrincipal");
    expect(body).not.toHaveProperty("conversationId");
    expect(JSON.stringify(body)).not.toContain("roles");
    expect(await total("conversations")).toBe(before.conversations);
    expect(await total("messages")).toBe(before.messages);
    expect(await total("turn_steps")).toBe(before.steps);
    const row = await audit("va-success");
    expect(row).toMatchObject({
      admin_principal_id: "member-jordan",
      assumed_principal_id: "member-priya",
      answer_type: "insufficient_evidence",
      diagnostic_shown: 0,
    });
    expect(row?.question_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("writes the audit row even when the turn fails, and completes it", async () => {
    const response = await asPriya(cookies["member-jordan"], "va-failure", {
      scopeDocumentId: "doc-finance-policy",
    });
    expect(response.status).toBe(404);
    expect(await audit("va-failure")).toMatchObject({
      admin_principal_id: "member-jordan",
      assumed_principal_id: "member-priya",
      answer_type: "error",
    });
  });

  it("is idempotent by request id and refuses a request id owned by another turn", async () => {
    await asPriya(cookies["member-jordan"], "va-idem");
    await asPriya(cookies["member-jordan"], "va-idem");
    expect(
      Number(
        (
          await env.OPERATIONS_DB.prepare(`SELECT COUNT(*) AS n FROM view_as_audits WHERE request_id = ?`)
            .bind("va-idem")
            .first<{ n: number }>()
        )?.n,
      ),
    ).toBe(1);
    const other = await call("/turns", cookies["member-jordan"], {
      json: { question: "Hello there", requestId: "va-idem", assumePrincipalId: "member-maya" },
    });
    expect(other.status).toBe(400);
  });

  it("ignores a client grant list in session mode and resolves grants from the directory", async () => {
    const response = await asPriya(cookies["member-jordan"], "va-grants", {
      assumePrincipal: { userId: "member-priya", roles: ["admin", "finance_manager"], departments: ["finance"] },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { assumedPerson: { readableDocuments: number } };
    const honest = await asPriya(cookies["member-jordan"], "va-grants-honest");
    const honestBody = (await honest.json()) as { assumedPerson: { readableDocuments: number } };
    expect(body.assumedPerson.readableDocuments).toBe(honestBody.assumedPerson.readableDocuments);
  });

  it("ignores a lone grant list in session mode: the turn runs as the caller", async () => {
    const response = await call("/turns", cookies["member-maya"], {
      json: {
        question: "What are the final pay rules?",
        requestId: "va-lone-grants",
        persistConversation: false,
        assumePrincipal: { userId: "x", roles: ["admin"], departments: ["finance"] },
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("assumedPrincipal");
  });

  it("refuses an evalModel or a persisted view-as turn", async () => {
    const evalModel = await asPriya(cookies["member-jordan"], "va-eval", { evalModel: "glm" });
    const persisted = await asPriya(cookies["member-jordan"], "va-persist", { persistConversation: true });
    expect(evalModel.status).toBe(400);
    expect(persisted.status).toBe(400);
  });

  it("works in loopback mode for an admin and refuses grants next to the id", async () => {
    await env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO roles (principal_id, role) VALUES ('principal-dev', 'admin')`,
    ).run();
    const ok = await fetchWorker(
      turnRequest({ question: "Hello there", requestId: "va-loop", assumePrincipalId: "member-priya" }),
      loopbackEnv,
    );
    expect(ok.status).toBe(200);
    const both = await fetchWorker(
      turnRequest({
        question: "Hello there",
        requestId: "va-loop-both",
        assumePrincipalId: "member-priya",
        assumePrincipal: EVAL_PRINCIPAL,
      }),
      loopbackEnv,
    );
    expect(both.status).toBe(400);
  });

  describe("exists-but-restricted diagnostic", () => {
    it("is returned to the admin after a refusal: title and readers label only", async () => {
      const response = await call("/turns", cookies["member-jordan"], {
        json: {
          question: "Who gives approval for spending?",
          requestId: "va-diag",
          assumePrincipalId: "member-maya",
        },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        structuredAnswer: { answerType: string };
        adminDiagnostic?: Array<Record<string, unknown>>;
      };
      expect(body.structuredAnswer.answerType).toBe("insufficient_evidence");
      expect(body.adminDiagnostic).toContainEqual({
        title: "Budget Approval Policy",
        readers: { kind: "roles", names: ["finance_manager"] },
      });
      for (const entry of body.adminDiagnostic ?? []) {
        expect(Object.keys(entry).sort()).toEqual(["readers", "title"]);
      }
      expect((await audit("va-diag"))?.diagnostic_shown).toBe(1);
    });

    it("never lists a private-owner document", async () => {
      const response = await call("/turns", cookies["member-jordan"], {
        json: { question: "Show the private notes", requestId: "va-private", assumePrincipalId: "member-priya" },
      });
      const body = (await response.json()) as { adminDiagnostic?: Array<{ title: string }> };
      expect((body.adminDiagnostic ?? []).map((entry) => entry.title)).not.toContain("Maya Private Notes");
    });

    it("is absent from an ordinary refusal and for a non-view-as turn", async () => {
      const response = await call("/turns", cookies["member-maya"], {
        json: { question: "Who gives approval for spending?", requestId: "va-plain" },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).not.toHaveProperty("adminDiagnostic");
    });

    it("never enters the model context", async () => {
      const faux = fauxProvider({ provider: "view-as-faux" });
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("search_knowledge", { query: "approval spending" })], {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage([fauxText("x")], { stopReason: "stop" }),
      ]);
      const seen: unknown[] = [];
      const answer = await runViewAsTurn({
        operations: env.OPERATIONS_DB as OperationsDatabase,
        corpus: env.CORPUS_DB as never,
        lockFor: (id: string) => env.CONVERSATION.getByName(id),
        admin: { id: "member-jordan", subject: "jordan.ellis@northwind.example", kind: "user", roles: ["admin"], departments: ["operations"] },
        assumePrincipalId: "member-maya",
        question: "Who gives approval for spending?",
        requestId: "va-prompt",
        runtime: {
          model: faux.getModel(),
          stream: ((model: never, context: unknown, options: never) => {
            seen.push(context);
            return faux.provider.streamSimple(model, context as never, options);
          }) as never,
        },
      });
      expect(answer.adminDiagnostic?.length).toBeGreaterThan(0);
      expect(JSON.stringify(seen)).not.toContain("Budget Approval Policy");
      expect(JSON.stringify(seen)).not.toContain("finance_manager");
    });
  });
});
