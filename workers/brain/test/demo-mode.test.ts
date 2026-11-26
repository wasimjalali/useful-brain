import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import worker from "../src";
import { BRAIN_NOT_ENOUGH_EVIDENCE } from "../../../src/lib/agent/host-grounding";
import { DEMO_CLEANUP_STATEMENTS, DEMO_VISITOR_LIFETIME_MS, cleanupDemoVisitors } from "../../../src/lib/demo/demo-cleanup";
import { DEMO_READ_ONLY_MESSAGE } from "../../../src/lib/demo/demo-mode";
import { DEMO_QUESTIONS } from "../../../src/lib/demo/demo-script";
import { northwindSeedDocuments } from "../../../src/lib/eval/northwind-seed";
import { promoteGeneration } from "../../../src/lib/store/corpus-d1";
import { seedNorthwindCorpus } from "../../../src/lib/store/corpus-seed";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const demoEnv = {
  ...env,
  IDENTITY_MODE: "session",
  LOOPBACK_RUNTIME: "false",
  LOOPBACK_SUBJECT: "",
  DEMO_MODE: "true",
} as typeof env;

async function call(
  path: string,
  cookie: string | undefined,
  init: { method?: string; json?: unknown; workerEnv?: typeof env } = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const body = init.json === undefined ? undefined : JSON.stringify(init.json);
  const response = await worker.fetch(
    new IncomingRequest(`https://brain.internal${path}`, {
      method: init.method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body,
    }),
    init.workerEnv ?? demoEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

async function newVisitor(): Promise<{ cookie: string; id: string }> {
  const response = await call("/auth/demo", undefined, { method: "POST", json: {} });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { user: { id: string }; sessionToken: string };
  return { cookie: `usefulbrain.session=${body.sessionToken}`, id: body.user.id };
}

type TurnResponse = {
  conversationId: string;
  assistantMessageId: string;
  structuredAnswer: { answerType: string; paragraphs: Array<{ text: string; citations: string[] }> };
  retrieval?: { results?: Array<{ citationLabel?: string; documentId?: string | null }> };
};

async function ask(cookie: string, question: string, requestId: string): Promise<TurnResponse> {
  const response = await call("/turns", cookie, { json: { question, requestId } });
  expect(response.status).toBe(200);
  return (await response.json()) as TurnResponse;
}

let visitor: { cookie: string; id: string };

beforeAll(async () => {
  const seeded = await seedNorthwindCorpus({ db: env.CORPUS_DB, documents: northwindSeedDocuments() });
  await promoteGeneration(env.CORPUS_DB, seeded.generationId);
  visitor = await newVisitor();
});

describe("demo sign-in", () => {
  it("is refused outside the demo", async () => {
    const sessionEnv = { ...demoEnv, DEMO_MODE: "false" } as typeof env;
    const response = await call("/auth/demo", undefined, { method: "POST", json: {}, workerEnv: sessionEnv });
    expect(response.status).toBe(403);
  });

  it("makes each visitor their own admin who can read every department", async () => {
    const other = await newVisitor();
    expect(other.id).not.toBe(visitor.id);
    const whoami = (await (await call("/whoami", visitor.cookie)).json()) as {
      isAdmin: boolean;
      departments: string[];
      name: string | null;
    };
    expect(whoami.isAdmin).toBe(true);
    expect(whoami.name).toBe("Demo Admin");
    expect([...whoami.departments].sort()).toEqual(
      ["engineering", "executive", "finance", "hr", "legal", "operations", "sales", "support"],
    );
  });

  it("leaves visitors out of People", async () => {
    const response = await call("/admin/people", visitor.cookie);
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain("demo-visitor-");
  });

  it("refuses to start when a model is bound", async () => {
    const withModel = { ...demoEnv, AI: { run: async () => ({}) } } as unknown as typeof env;
    const response = await call("/whoami", visitor.cookie, { workerEnv: withModel });
    expect(response.status).toBeGreaterThanOrEqual(500);
  });
});

describe("demo read-only guard", () => {
  it.each([
    ["POST", "/knowledge/seed"],
    ["POST", "/knowledge/promote"],
    ["POST", "/knowledge/reindex"],
    ["DELETE", "/knowledge/documents/nw_hr_parental_leave"],
    ["POST", "/admin/invites"],
    ["POST", "/evaluations/run"],
    ["POST", "/approvals/start"],
  ])("refuses %s %s with the demo message", async (method, path) => {
    const response = await call(path, visitor.cookie, { method, json: {} });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: DEMO_READ_ONLY_MESSAGE });
  });

  it("leaves the corpus untouched after a refused write", async () => {
    const before = await env.CORPUS_DB.prepare(`SELECT COUNT(*) AS n FROM corpus_generations`).first<{ n: number }>();
    await call("/knowledge/seed", visitor.cookie, { json: { documents: northwindSeedDocuments() } });
    const after = await env.CORPUS_DB.prepare(`SELECT COUNT(*) AS n FROM corpus_generations`).first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });
});

describe("demo answers", () => {
  it("offers exactly the six scripted questions", async () => {
    const response = await call("/suggestions", visitor.cookie);
    const body = (await response.json()) as { suggestions: Array<{ text: string }> };
    expect(body.suggestions.map((item) => item.text)).toEqual(DEMO_QUESTIONS.map((item) => item.question));
  });

  it.each(DEMO_QUESTIONS.map((item, index) => [item.question, index] as const))(
    "answers %s verbatim from its document, with citations",
    async (question, index) => {
      const script = DEMO_QUESTIONS[index];
      const turn = await ask(visitor.cookie, question, `demo-q-${index}`);
      expect(turn.structuredAnswer.answerType).toBe("grounded");
      const paragraphs = turn.structuredAnswer.paragraphs;
      expect(paragraphs).toHaveLength(script.quotes.length);
      for (const [position, quote] of script.quotes.entries()) {
        expect(paragraphs[position].text).toContain(quote);
        expect(paragraphs[position].citations.length).toBeGreaterThan(0);
      }
      const cited = new Set(paragraphs.flatMap((paragraph) => paragraph.citations));
      const citedDocuments = (turn.retrieval?.results ?? [])
        .filter((result) => result.citationLabel && cited.has(result.citationLabel))
        .map((result) => result.documentId);
      expect(citedDocuments.length).toBeGreaterThan(0);
      expect(new Set(citedDocuments)).toEqual(new Set([script.documentId]));
    },
  );

  it("declines an off-script question with the not-enough-evidence answer", async () => {
    const turn = await ask(visitor.cookie, "What is the CEO's favourite colour?", "demo-off-script");
    expect(turn.structuredAnswer.answerType).toBe("insufficient_evidence");
    expect(JSON.stringify(turn.structuredAnswer)).toContain(BRAIN_NOT_ENOUGH_EVIDENCE);
  });

  it("keeps each visitor's chats to themselves", async () => {
    const other = await newVisitor();
    const mine = (await (await call("/conversations", visitor.cookie)).json()) as unknown[];
    const theirs = (await (await call("/conversations", other.cookie)).json()) as unknown[];
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs).toEqual([]);
  });
});

describe("demo visitor cleanup", () => {
  async function countFor(principalId: string): Promise<number> {
    const queries = [
      `SELECT COUNT(*) AS n FROM principals WHERE id = ?1`,
      `SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?1`,
      `SELECT COUNT(*) AS n FROM roles WHERE principal_id = ?1`,
      `SELECT COUNT(*) AS n FROM conversations WHERE owner_principal_id = ?1`,
      `SELECT COUNT(*) AS n FROM agent_runs WHERE principal_id = ?1`,
      `SELECT COUNT(*) AS n FROM message_feedback WHERE principal_id = ?1`,
      `SELECT COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.owner_principal_id = ?1`,
    ];
    let total = 0;
    for (const sql of queries) {
      const row = await env.OPERATIONS_DB.prepare(sql).bind(principalId).first<{ n: number }>();
      total += Number(row?.n ?? 0);
    }
    return total;
  }

  it("covers every operations table that can hold a visitor's rows", async () => {
    // Tables reachable from principals through foreign keys must each have a cleanup statement.
    const roots = new Set(["principals"]);
    const { results: tables } = await env.OPERATIONS_DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`,
    ).all<{ name: string }>();
    const references = new Map<string, string[]>();
    for (const { name } of tables) {
      const { results } = await env.OPERATIONS_DB.prepare(`SELECT "table" AS target FROM pragma_foreign_key_list(?)`)
        .bind(name)
        .all<{ target: string }>();
      references.set(name, results.map((row) => row.target));
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const [table, targets] of references) {
        if (!roots.has(table) && targets.some((target) => roots.has(target))) {
          roots.add(table);
          grew = true;
        }
      }
    }
    const covered = new Set(DEMO_CLEANUP_STATEMENTS.map((entry) => entry.table));
    expect([...roots].filter((table) => !covered.has(table))).toEqual([]);
  });

  it("removes a day-old visitor and everything they made, and keeps a new one", async () => {
    await env.OPERATIONS_DB.prepare(
      `INSERT INTO principals (id, kind, subject, created_at) VALUES ('person-keep', 'user', 'keep@northwind.example', 0)`,
    ).run();
    const old = await newVisitor();
    const oldTurn = await ask(old.cookie, DEMO_QUESTIONS[0].question, "demo-cleanup-old");
    const feedback = await call(`/messages/${oldTurn.assistantMessageId}/feedback`, old.cookie, { json: { value: "up" } });
    expect(feedback.ok).toBe(true);
    const fresh = await newVisitor();
    await ask(fresh.cookie, DEMO_QUESTIONS[1].question, "demo-cleanup-fresh");
    expect(await countFor(old.id)).toBeGreaterThan(0);

    const freshCreated = await env.OPERATIONS_DB.prepare(`SELECT created_at FROM principals WHERE id = ?`)
      .bind(fresh.id)
      .first<{ created_at: number }>();
    // The old visitor is made a day older; the fresh one stays inside the window.
    await env.OPERATIONS_DB.prepare(`UPDATE principals SET created_at = ? WHERE id = ?`)
      .bind(Number(freshCreated?.created_at) - DEMO_VISITOR_LIFETIME_MS - 1, old.id)
      .run();
    await cleanupDemoVisitors(env.OPERATIONS_DB, Number(freshCreated?.created_at) + 1);

    expect(await countFor(old.id)).toBe(0);
    expect(await countFor(fresh.id)).toBeGreaterThan(0);
    const kept = await env.OPERATIONS_DB.prepare(`SELECT COUNT(*) AS n FROM principals WHERE id = 'person-keep'`).first<{ n: number }>();
    expect(Number(kept?.n)).toBe(1);
    const fk = await env.OPERATIONS_DB.prepare(`SELECT COUNT(*) AS n FROM pragma_foreign_key_check`).first<{ n: number }>();
    expect(Number(fk?.n)).toBe(0);
  });
});
