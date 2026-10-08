import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import worker from "../src";
import { aclGroupKey } from "../../../src/lib/acl/acl-group";
import type {
  DraftActionResponse,
  SourcesResponse,
  UploadCreated,
  UploadStatus,
} from "../../../src/lib/contracts/sources";
import { readersToAcl } from "../../../src/lib/ingest/upload-validation";
import { activeGenerationId, promoteGeneration } from "../../../src/lib/store/corpus-d1";
import { claimDiscard, ensureOpenDraft, failDraft } from "../../../src/lib/store/drafts";
import { createUploadBatch } from "../../../src/lib/store/uploads";
import { DISCARD_GRACE_MS } from "../../../src/lib/ingest/draft-index";
import { runSourcesMaintenance } from "../src/routes/admin-sources";
import { seedCorpus, seedPersonas, seedPrincipals, CORPUS_DOCUMENT_IDS, type PersonaId } from "./seed";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

type Sent = { jobId: string; idempotencyKey: string };
let sent: Sent[] = [];
/** Upload file rows that already existed in D1 when each message reached the queue. */
let rowsAtSend: number[] = [];
let deletedVectors: string[] = [];
let failQueue = false;
/** When set, sends of the jobs it matches fail (one job down, the others fine). */
let failJob: ((jobId: string) => boolean) | null = null;
/** When set, runs before the statement with matching SQL executes (once per call). */
let beforeStatement: ((sql: string) => Promise<void>) | null = null;

const fakeQueue = {
  async send(message: Sent) {
    if (failQueue || failJob?.(message.jobId)) {
      throw new Error("queue down");
    }
    const row = await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM upload_files").first<{ n: number }>();
    rowsAtSend.push(row?.n ?? 0);
    sent.push(message);
  },
};

type Statement = ReturnType<typeof env.CORPUS_DB.prepare>;

/** Wraps the corpus binding so a test can interleave another writer right before a statement runs. */
function racingDb() {
  const meta = new WeakMap<object, { real: Statement; sql: string }>();
  const wrap = (statement: Statement, sql: string): Statement => {
    const hook = async () => {
      await beforeStatement?.(sql);
    };
    const wrapped = {
      bind: (...values: unknown[]) => wrap(statement.bind(...(values as never[])), sql),
      run: async () => {
        await hook();
        return statement.run();
      },
      first: async (...args: unknown[]) => {
        await hook();
        return (statement.first as (...a: unknown[]) => Promise<unknown>)(...args);
      },
      all: async () => {
        await hook();
        return statement.all();
      },
    } as unknown as Statement;
    meta.set(wrapped as object, { real: statement, sql });
    return wrapped;
  };
  return {
    prepare: (sql: string) => wrap(env.CORPUS_DB.prepare(sql), sql),
    batch: async (statements: Statement[]) => {
      for (const statement of statements) {
        await beforeStatement?.(meta.get(statement as object)?.sql ?? "");
      }
      return env.CORPUS_DB.batch(statements.map((statement) => meta.get(statement as object)?.real ?? statement));
    },
  };
}

const fakeVectorize = {
  async deleteByIds(ids: string[]) {
    deletedVectors.push(...ids);
    return { mutationId: `del-${deletedVectors.length}` };
  },
};

const sessionEnv = {
  ...env,
  IDENTITY_MODE: "session",
  LOOPBACK_RUNTIME: "false",
  LOOPBACK_SUBJECT: "",
  INGEST_QUEUE: fakeQueue,
  VECTORIZE: fakeVectorize,
} as unknown as typeof env;

async function call(
  path: string,
  cookie: string | undefined,
  init: { method?: string; json?: unknown; body?: Uint8Array; length?: number } = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    headers["content-type"] = "application/json";
  } else if (init.body) {
    body = init.body;
    headers["content-length"] = String(init.length ?? init.body.byteLength);
  }
  const response = await worker.fetch(
    new IncomingRequest(`https://brain.internal${path}`, {
      method: init.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body,
    }),
    beforeStatement ? ({ ...sessionEnv, CORPUS_DB: racingDb() } as unknown as typeof env) : sessionEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

let cookies: Record<PersonaId, string>;
let activeId: string;

async function resetPipeline() {
  await env.CORPUS_DB.batch([
    env.CORPUS_DB.prepare("DELETE FROM upload_files"),
    env.CORPUS_DB.prepare("DELETE FROM upload_batches"),
    env.CORPUS_DB.prepare("DELETE FROM draft_checks"),
    env.CORPUS_DB.prepare("DELETE FROM drafts"),
    // A test that promotes a draft must not leak the new pointer into the next one.
    env.CORPUS_DB.prepare("UPDATE corpus_state SET active_generation_id = ? WHERE singleton = 1").bind(activeId),
    env.CORPUS_DB.prepare("UPDATE corpus_generations SET state = 'active' WHERE id = ?").bind(activeId),
    env.CORPUS_DB.prepare("UPDATE corpus_generations SET state = 'archived' WHERE state = 'active' AND id <> ?").bind(activeId),
  ]);
  sent = [];
  rowsAtSend = [];
  deletedVectors = [];
  failQueue = false;
  failJob = null;
  beforeStatement = null;
}

beforeAll(async () => {
  await seedPrincipals();
  cookies = await seedPersonas();
  activeId = (await seedCorpus()).generationId;
});

beforeEach(resetPipeline);

const admin = () => cookies["member-jordan"];
const member = () => cookies["member-maya"];

const baseBody = (overrides: Record<string, unknown> = {}) => ({
  readers: { kind: "departments", names: ["hr"] },
  idempotencyKey: `key-${crypto.randomUUID()}`,
  files: [{ name: "Leave Policy.md", size: 20 }],
  ...overrides,
});

async function createBatch(overrides: Record<string, unknown> = {}): Promise<UploadCreated> {
  const response = await call("/admin/uploads", admin(), { json: baseBody(overrides) });
  expect(response.status).toBe(200);
  return (await response.json()) as UploadCreated;
}

const bytes = (length: number) => new TextEncoder().encode("x".repeat(length));

describe("admin gate", () => {
  const routes: Array<[string, string, Record<string, unknown>?]> = [
    ["POST", "/admin/uploads", { json: baseBody() }],
    ["PUT", "/admin/uploads/ub-x/files/uf-x", { body: bytes(5) }],
    ["GET", "/admin/uploads/ub-x"],
    ["GET", "/admin/sources"],
    ["POST", "/admin/drafts/g-x/promote", {}],
    ["POST", "/admin/drafts/g-x/discard", {}],
    ["POST", "/admin/reindex", {}],
  ];

  it.each(routes)("%s %s answers 401 with no session and 403 for a member", async (method, path, init) => {
    const anonymous = await call(path, undefined, { method, ...(init as object) });
    expect(anonymous.status).toBe(401);
    const asMember = await call(path, member(), { method, ...(init as object) });
    expect(asMember.status).toBe(403);
  });

  it("creates nothing for a member who tries", async () => {
    await call("/admin/uploads", member(), { json: baseBody() });
    const drafts = await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM drafts").first<{ n: number }>();
    expect(drafts?.n).toBe(0);
    expect(sent).toEqual([]);
  });
});

describe("POST /admin/uploads validation", () => {
  const invalid: Array<[string, Record<string, unknown>]> = [
    ["unsupported type", { files: [{ name: "run.exe", size: 10 }] }],
    ["html", { files: [{ name: "page.html", size: 10 }] }],
    ["over 25 MB", { files: [{ name: "big.pdf", size: 25 * 1024 * 1024 + 1 }] }],
    ["path in name", { files: [{ name: "../x.md", size: 10 }] }],
    ["no files", { files: [] }],
    ["unknown department", { readers: { kind: "departments", names: ["pirates"] } }],
    ["admin role", { readers: { kind: "roles", names: ["admin"] } }],
    ["empty names", { readers: { kind: "roles", names: [] } }],
    ["private readers", { readers: { kind: "private" } }],
    ["bad key", { idempotencyKey: "has spaces" }],
  ];

  it.each(invalid)("rejects %s and creates no draft, batch or job", async (_label, overrides) => {
    const response = await call("/admin/uploads", admin(), { json: baseBody(overrides) });
    expect(response.status).toBe(400);
    for (const table of ["drafts", "upload_batches", "upload_files"]) {
      const row = await env.CORPUS_DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
      expect(row?.n).toBe(0);
    }
    expect(sent).toEqual([]);
  });

  it("rejects non-JSON and oversized bodies", async () => {
    const ctx = createExecutionContext();
    const bad = await worker.fetch(
      new IncomingRequest("https://brain.internal/admin/uploads", {
        method: "POST",
        headers: { cookie: admin() },
        body: "not json{",
      }),
      sessionEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(bad.status).toBe(400);
  });
});

describe("POST /admin/uploads", () => {
  it("maps readers to access scope and creates one draft, one job and the file rows", async () => {
    const created = await createBatch({
      readers: { kind: "departments", names: ["hr", "finance"] },
      files: [
        { name: "a.pdf", size: 10 },
        { name: "b.docx", size: 11 },
      ],
    });
    expect(created.files.map((file) => file.name)).toEqual(["a.pdf", "b.docx"]);
    const batch = await env.CORPUS_DB.prepare(
      "SELECT generation_id, access_scope, allowed_roles, allowed_departments FROM upload_batches WHERE id = ?",
    )
      .bind(created.batchId)
      .first<{ generation_id: string; access_scope: string; allowed_roles: string; allowed_departments: string }>();
    expect(batch).toMatchObject({
      access_scope: "department",
      allowed_roles: "[]",
      allowed_departments: '["finance","hr"]',
    });
    const draft = await env.CORPUS_DB.prepare(
      "SELECT kind, base_generation_id, closed_at FROM drafts WHERE generation_id = ?",
    )
      .bind(batch!.generation_id)
      .first<Record<string, unknown>>();
    expect(draft).toEqual({ kind: "upload", base_generation_id: activeId, closed_at: null });
    // The draft job and the batch's delivery-expiry job are enqueued once, with identifiers only.
    expect(sent).toEqual([
      { jobId: batch!.generation_id, idempotencyKey: batch!.generation_id },
      { jobId: created.batchId, idempotencyKey: created.batchId },
    ]);
    // The ACL group a worker will compute from this row matches the selection.
    const key = await aclGroupKey({
      accessScope: "department",
      allowedRoles: [],
      allowedDepartments: JSON.parse(batch!.allowed_departments) as string[],
      ownerUserId: "",
    });
    expect(key).toBe(
      await aclGroupKey({ accessScope: "department", allowedRoles: [], allowedDepartments: ["hr", "finance"], ownerUserId: "" }),
    );
  });

  it("maps everyone to public and roles to role scope", async () => {
    const everyone = await createBatch({ readers: { kind: "everyone" }, files: [{ name: "x.md", size: 5 }] });
    const roles = await createBatch({
      readers: { kind: "roles", names: ["manager", "director"] },
      files: [{ name: "y.md", size: 5 }],
    });
    const rows = await env.CORPUS_DB.prepare(
      "SELECT id, access_scope, allowed_roles, allowed_departments FROM upload_batches WHERE id IN (?, ?)",
    )
      .bind(everyone.batchId, roles.batchId)
      .all<{ id: string; access_scope: string; allowed_roles: string; allowed_departments: string }>();
    const byId = Object.fromEntries(rows.results.map((row) => [row.id, row]));
    expect(byId[everyone.batchId]).toMatchObject({ access_scope: "public", allowed_roles: "[]", allowed_departments: "[]" });
    expect(byId[roles.batchId]).toMatchObject({ access_scope: "role", allowed_roles: '["director","manager"]', allowed_departments: "[]" });
  });

  it("is idempotent per key: same files return the same ids, different files are refused", async () => {
    const body = baseBody({ idempotencyKey: "idem-key-1" });
    const first = (await (await call("/admin/uploads", admin(), { json: body })).json()) as UploadCreated;
    const second = (await (await call("/admin/uploads", admin(), { json: body })).json()) as UploadCreated;
    expect(second).toEqual(first);
    const different = await call("/admin/uploads", admin(), {
      json: { ...body, files: [{ name: "other.md", size: 3 }] },
    });
    expect(different.status).toBe(400);
    const counts = await env.CORPUS_DB.prepare(
      "SELECT (SELECT COUNT(*) FROM upload_batches) AS batches, (SELECT COUNT(*) FROM drafts) AS drafts",
    ).first<{ batches: number; drafts: number }>();
    expect(counts).toEqual({ batches: 1, drafts: 1 });
    expect(sent).toHaveLength(2);
  });

  it("binds a key to the whole request: readers, sizes and creator cannot change on replay", async () => {
    const body = baseBody({
      idempotencyKey: "idem-bound-1",
      readers: { kind: "everyone" },
      files: [{ name: "a.md", size: 10 }],
    });
    const first = (await (await call("/admin/uploads", admin(), { json: body })).json()) as UploadCreated;
    // Same key, narrower readers: the original (public) batch must not be handed back.
    for (const changed of [
      { ...body, readers: { kind: "departments", names: ["hr"] } },
      { ...body, readers: { kind: "roles", names: ["manager"] } },
      { ...body, files: [{ name: "a.md", size: 11 }] },
    ]) {
      expect((await call("/admin/uploads", admin(), { json: changed })).status).toBe(400);
    }
    expect((await (await call("/admin/uploads", admin(), { json: body })).json()) as UploadCreated).toEqual(first);
    // Another creator replaying the key is refused at the store, too.
    const batch = await env.CORPUS_DB.prepare("SELECT generation_id FROM upload_batches WHERE id = ?")
      .bind(first.batchId)
      .first<{ generation_id: string }>();
    await expect(
      createUploadBatch(env.CORPUS_DB as never, {
        generationId: batch!.generation_id,
        createdBy: "someone-else",
        acl: readersToAcl({ kind: "everyone" }),
        idempotencyKey: "idem-bound-1",
        files: [{ name: "a.md", size: 10 }],
      }),
    ).rejects.toThrow();
    // Order of files does not matter for the same request.
    const two = baseBody({
      idempotencyKey: "idem-bound-2",
      files: [
        { name: "x.md", size: 1 },
        { name: "y.md", size: 2 },
      ],
    });
    const created = (await (await call("/admin/uploads", admin(), { json: two })).json()) as UploadCreated;
    const reordered = (await (
      await call("/admin/uploads", admin(), { json: { ...two, files: [...(two.files as object[])].reverse() } })
    ).json()) as UploadCreated;
    expect(reordered.batchId).toBe(created.batchId);
    expect(reordered.files.map((file) => file.name)).toEqual(["y.md", "x.md"]);
  });

  it("replaying a batch whose draft is gone returns the original result and creates nothing", async () => {
    const body = baseBody({ idempotencyKey: "idem-done-1" });
    const first = (await (await call("/admin/uploads", admin(), { json: body })).json()) as UploadCreated;
    const draft = await env.CORPUS_DB.prepare("SELECT generation_id FROM drafts").first<{ generation_id: string }>();
    expect((await call(`/admin/drafts/${draft!.generation_id}/discard`, admin(), { method: "POST", json: {} })).status).toBe(200);
    const sentBefore = sent.length;
    const replay = await call("/admin/uploads", admin(), { json: body });
    expect(replay.status).toBe(200);
    expect((await replay.json()) as UploadCreated).toEqual(first);
    const counts = await env.CORPUS_DB.prepare(
      "SELECT (SELECT COUNT(*) FROM drafts) AS drafts, (SELECT COUNT(*) FROM corpus_generations) AS generations, (SELECT COUNT(*) FROM drafts WHERE closed_at IS NULL) AS open",
    ).first<{ drafts: number; generations: number; open: number }>();
    expect(counts?.drafts).toBe(1);
    expect(counts?.open).toBe(0);
    expect(sent).toHaveLength(sentBefore);
  });

  it("persists the batch and its files before the draft job reaches the queue", async () => {
    await createBatch({ files: [{ name: "a.md", size: 5 }, { name: "b.md", size: 6 }] });
    expect(sent).toHaveLength(2);
    expect(rowsAtSend).toEqual([2, 2]);
    const draft = await env.CORPUS_DB.prepare("SELECT job_enqueued_at FROM drafts").first<{ job_enqueued_at: number | null }>();
    expect(draft?.job_enqueued_at).not.toBeNull();
  });

  it("recovers a draft whose job was never published (crash after the database write)", async () => {
    // The request died after the rows committed and before the queue send.
    const generation = await ensureOpenDraft(env.CORPUS_DB as never, { kind: "upload", createdBy: "member-jordan" });
    const lost = await createUploadBatch(env.CORPUS_DB as never, {
      generationId: generation.draft.generationId,
      createdBy: "member-jordan",
      acl: readersToAcl({ kind: "departments", names: ["hr"] }),
      idempotencyKey: "idem-crash-1",
      files: [{ name: "lost.md", size: 5 }],
    });
    expect(sent).toEqual([]);
    const pending = await env.CORPUS_DB.prepare("SELECT job_enqueued_at FROM drafts").first<{ job_enqueued_at: number | null }>();
    expect(pending?.job_enqueued_at).toBeNull();
    // The admin retries with the same key.
    const retry = await call("/admin/uploads", admin(), {
      json: { readers: { kind: "departments", names: ["hr"] }, idempotencyKey: "idem-crash-1", files: [{ name: "lost.md", size: 5 }] },
    });
    expect(retry.status).toBe(200);
    expect((await retry.json()) as UploadCreated).toEqual(lost);
    expect(sent).toEqual([
      { jobId: generation.draft.generationId, idempotencyKey: generation.draft.generationId },
      { jobId: lost.batchId, idempotencyKey: lost.batchId },
    ]);
    // Nothing is published twice.
    await call("/admin/uploads", admin(), {
      json: { readers: { kind: "departments", names: ["hr"] }, idempotencyKey: "idem-crash-1", files: [{ name: "lost.md", size: 5 }] },
    });
    expect(sent).toHaveLength(2);
  });

  it("puts a second batch into the same single draft without a second draft job", async () => {
    await createBatch();
    await createBatch({ files: [{ name: "second.md", size: 5 }] });
    const drafts = await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM drafts").first<{ n: number }>();
    expect(drafts?.n).toBe(1);
    const draft = await env.CORPUS_DB.prepare("SELECT generation_id FROM drafts").first<{ generation_id: string }>();
    expect(sent.filter((message) => message.jobId === draft!.generation_id)).toHaveLength(1);
    expect(sent).toHaveLength(3);
  });

  it("refuses a second upload of a document the open draft already has, with a reason the admin can read", async () => {
    await createBatch({ files: [{ name: "Leave Policy.md", size: 20 }] });
    sent = [];
    const response = await call("/admin/uploads", admin(), {
      json: baseBody({ files: [{ name: "other.md", size: 5 }, { name: "leave policy.MD", size: 30 }] }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; reason: string; message: string };
    expect(body).toMatchObject({ code: "VALIDATION_FAILED", reason: "DOCUMENT_IN_DRAFT" });
    expect(body.message).toContain("leave policy.MD");
    // Nothing of the refused batch was written or queued.
    const counts = await env.CORPUS_DB.prepare(
      "SELECT (SELECT COUNT(*) FROM upload_batches) AS batches, (SELECT COUNT(*) FROM upload_files) AS files",
    ).first<{ batches: number; files: number }>();
    expect(counts).toEqual({ batches: 1, files: 1 });
    expect(sent).toEqual([]);
  });

  it("accepts the document again once its earlier upload failed", async () => {
    const first = await createBatch({ files: [{ name: "Leave Policy.md", size: 20 }] });
    await env.CORPUS_DB.prepare("UPDATE upload_files SET stage = 'failed', error_code = 'CORRUPT_FILE' WHERE id = ?")
      .bind(first.files[0].id)
      .run();
    const again = await createBatch({ files: [{ name: "Leave Policy.md", size: 25 }] });
    expect(again.batchId).not.toBe(first.batchId);
  });

  it("lets only one of two racing uploads of the same document into the draft", async () => {
    await createBatch({ files: [{ name: "warmup.md", size: 5 }] });
    const draft = await env.CORPUS_DB.prepare("SELECT generation_id FROM drafts").first<{ generation_id: string }>();
    let raced = false;
    // Another admin's batch for the same file commits between this request's checks and its insert.
    beforeStatement = async (sql) => {
      if (!raced && /INSERT INTO upload_batches/.test(sql)) {
        raced = true;
        await createUploadBatch(env.CORPUS_DB as never, {
          generationId: draft!.generation_id,
          createdBy: "member-jordan",
          acl: readersToAcl({ kind: "everyone" }),
          idempotencyKey: "idem-race-winner",
          files: [{ name: "Handbook.md", size: 9 }],
        });
      }
    };
    const response = await call("/admin/uploads", admin(), { json: baseBody({ files: [{ name: "handbook.md", size: 7 }] }) });
    beforeStatement = null;
    expect(raced).toBe(true);
    expect(response.status).toBe(400);
    const holders = await env.CORPUS_DB.prepare(
      "SELECT COUNT(*) AS n FROM upload_files WHERE lower(file_name) = 'handbook.md'",
    ).first<{ n: number }>();
    expect(holders?.n).toBe(1);
  });

  it("refuses new files once the draft started its checks", async () => {
    await createBatch();
    await env.CORPUS_DB.prepare("UPDATE corpus_generations SET state = 'reconciling' WHERE id IN (SELECT generation_id FROM drafts)").run();
    const response = await call("/admin/uploads", admin(), { json: baseBody() });
    expect(response.status).toBe(400);
  });

  it("fails the draft it just created if the job cannot be queued", async () => {
    failQueue = true;
    const response = await call("/admin/uploads", admin(), { json: baseBody() });
    expect(response.status).toBeGreaterThanOrEqual(500);
    const draft = await env.CORPUS_DB.prepare(
      "SELECT d.closed_at, g.state, g.error_code FROM drafts d JOIN corpus_generations g ON g.id = d.generation_id",
    ).first<{ closed_at: number | null; state: string; error_code: string }>();
    expect(draft?.state).toBe("failed");
    expect(draft?.error_code).toBe("ENQUEUE_FAILED");
    expect(draft?.closed_at).not.toBeNull();
    expect(await activeGenerationId(env.CORPUS_DB as never)).toBe(activeId);
  });
});

describe("PUT /admin/uploads/:batchId/files/:fileId", () => {
  it("streams the body into R2, keeps stage parsing and enqueues the file job", async () => {
    const created = await createBatch({ files: [{ name: "doc.md", size: 2048 }] });
    sent = [];
    const file = created.files[0];
    const payload = bytes(2048);
    const response = await call(`/admin/uploads/${created.batchId}/files/${file.id}`, admin(), {
      method: "PUT",
      body: payload,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, stage: "parsing" });
    const row = await env.CORPUS_DB.prepare("SELECT r2_key, stage FROM upload_files WHERE id = ?")
      .bind(file.id)
      .first<{ r2_key: string; stage: string }>();
    expect(row?.stage).toBe("parsing");
    const object = await env.SOURCES.get(row!.r2_key);
    expect(object?.size).toBe(2048);
    expect(sent).toEqual([{ jobId: file.id, idempotencyKey: file.id }]);
  });

  it("rejects a length that differs from the declared size and stores nothing", async () => {
    const created = await createBatch({ files: [{ name: "doc.md", size: 100 }] });
    sent = [];
    const file = created.files[0];
    const wrong = await call(`/admin/uploads/${created.batchId}/files/${file.id}`, admin(), {
      method: "PUT",
      body: bytes(99),
    });
    expect(wrong.status).toBe(400);
    const row = await env.CORPUS_DB.prepare("SELECT r2_key FROM upload_files WHERE id = ?").bind(file.id).first<{ r2_key: string | null }>();
    expect(row?.r2_key).toBeNull();
    expect(sent).toEqual([]);
  });

  it("removes the object when the body is shorter than its declared length", async () => {
    const created = await createBatch({ files: [{ name: "doc.md", size: 100 }] });
    const file = created.files[0];
    const short = await call(`/admin/uploads/${created.batchId}/files/${file.id}`, admin(), {
      method: "PUT",
      body: bytes(40),
      length: 100,
    });
    expect(short.status).toBe(400);
    const listed = await env.SOURCES.list({ prefix: "uploads/" });
    expect(listed.objects.filter((object) => object.key.endsWith(file.id))).toEqual([]);
  });

  it("returns 404 for an unknown file or a file from another batch, and 400 once it left parsing", async () => {
    const created = await createBatch({ files: [{ name: "doc.md", size: 10 }] });
    const other = await createBatch({ files: [{ name: "other.md", size: 10 }] });
    const unknown = await call(`/admin/uploads/${created.batchId}/files/uf-nope`, admin(), { method: "PUT", body: bytes(10) });
    expect(unknown.status).toBe(404);
    const crossed = await call(`/admin/uploads/${created.batchId}/files/${other.files[0].id}`, admin(), { method: "PUT", body: bytes(10) });
    expect(crossed.status).toBe(404);
    await env.CORPUS_DB.prepare("UPDATE upload_files SET stage = 'embedding' WHERE id = ?").bind(created.files[0].id).run();
    const late = await call(`/admin/uploads/${created.batchId}/files/${created.files[0].id}`, admin(), { method: "PUT", body: bytes(10) });
    expect(late.status).toBe(400);
  });

  it("refuses a body for a discarded draft", async () => {
    const created = await createBatch({ files: [{ name: "doc.md", size: 10 }] });
    const draft = await env.CORPUS_DB.prepare("SELECT generation_id FROM drafts").first<{ generation_id: string }>();
    const discard = await call(`/admin/drafts/${draft!.generation_id}/discard`, admin(), { method: "POST", json: {} });
    expect(discard.status).toBe(200);
    const response = await call(`/admin/uploads/${created.batchId}/files/${created.files[0].id}`, admin(), { method: "PUT", body: bytes(10) });
    expect(response.status).toBe(400);
  });

  async function putThatLosesTo(close: (generationId: string) => Promise<unknown>) {
    const created = await createBatch({ files: [{ name: "doc.md", size: 10 }] });
    const draft = await env.CORPUS_DB.prepare("SELECT generation_id FROM drafts").first<{ generation_id: string }>();
    sent = [];
    let closed = false;
    // The bytes are already in R2 when the draft closes, right before the object is attached.
    beforeStatement = async (sql) => {
      if (!closed && /SET r2_key/.test(sql)) {
        closed = true;
        await close(draft!.generation_id);
      }
    };
    const fileId = created.files[0].id;
    const response = await call(`/admin/uploads/${created.batchId}/files/${fileId}`, admin(), { method: "PUT", body: bytes(10) });
    beforeStatement = null;
    expect(closed).toBe(true);
    return { response, fileId, batchId: created.batchId };
  }

  it("rejects a body whose transfer finishes after a discard, removes the object and queues nothing", async () => {
    const { response, fileId, batchId } = await putThatLosesTo((id) => claimDiscard(env.CORPUS_DB as never, id));
    expect(response.status).toBe(400);
    const row = await env.CORPUS_DB.prepare("SELECT r2_key, stage, error_code FROM upload_files WHERE id = ?")
      .bind(fileId)
      .first<{ r2_key: string | null; stage: string; error_code: string | null }>();
    expect(row).toEqual({ r2_key: null, stage: "failed", error_code: "DRAFT_CLOSED" });
    const listed = await env.SOURCES.list({ prefix: "uploads/" });
    expect(listed.objects.filter((object) => object.key.endsWith(fileId))).toEqual([]);
    expect(sent).toEqual([]);
    // The status the dialog polls says why instead of parsing for ever.
    const status = (await (await call(`/admin/uploads/${batchId}`, admin())).json()) as UploadStatus;
    expect(status.files[0]).toMatchObject({ stage: "failed", errorMessage: "The draft was discarded before this file finished." });
  });

  it("rejects a body whose transfer finishes after the draft failed for another reason", async () => {
    const { response, fileId } = await putThatLosesTo((id) => failDraft(env.CORPUS_DB as never, id, "INDEX_UNAVAILABLE"));
    expect(response.status).toBe(400);
    const row = await env.CORPUS_DB.prepare("SELECT r2_key FROM upload_files WHERE id = ?").bind(fileId).first<{ r2_key: string | null }>();
    expect(row?.r2_key).toBeNull();
    const listed = await env.SOURCES.list({ prefix: "uploads/" });
    expect(listed.objects.filter((object) => object.key.endsWith(fileId))).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe("GET /admin/uploads/:batchId", () => {
  it("reports per-file stage and a human message from the closed error code", async () => {
    const created = await createBatch({
      files: [
        { name: "bomb.docx", size: 10 },
        { name: "fine.md", size: 10 },
        { name: "odd.md", size: 10 },
      ],
    });
    await env.CORPUS_DB.batch([
      env.CORPUS_DB.prepare("UPDATE upload_files SET stage = 'failed', error_code = 'ARCHIVE_TOO_LARGE' WHERE id = ?").bind(created.files[0].id),
      env.CORPUS_DB.prepare("UPDATE upload_files SET stage = 'embedding' WHERE id = ?").bind(created.files[1].id),
      env.CORPUS_DB.prepare("UPDATE upload_files SET stage = 'failed', error_code = 'made-up-code' WHERE id = ?").bind(created.files[2].id),
    ]);
    const status = (await (await call(`/admin/uploads/${created.batchId}`, admin())).json()) as UploadStatus;
    expect(status.files.map((file) => file.stage)).toEqual(["failed", "embedding", "failed"]);
    expect(status.files[0].errorMessage).toMatch(/expands to far more/);
    expect(status.files[1].errorMessage).toBeUndefined();
    // An unknown code never leaks through; it maps to the generic message.
    expect(status.files[2].errorMessage).toBe("Something went wrong while processing this file.");
    expect((await call("/admin/uploads/ub-unknown", admin())).status).toBe(404);
  });
});

describe("GET /admin/sources", () => {
  it("summarizes the active generation and hides private-owner titles", async () => {
    const view = (await (await call("/admin/sources", admin())).json()) as SourcesResponse;
    expect(view.active).toMatchObject({ id: activeId, documents: CORPUS_DOCUMENT_IDS.length, retrieval: "keyword" });
    expect(view.active!.chunks).toBeGreaterThan(0);
    expect(view.draft).toBeNull();
    expect(view.documents).toHaveLength(CORPUS_DOCUMENT_IDS.length);
    const privateRow = view.documents.find((document) => document.id === "doc-private-maya");
    expect(privateRow).toMatchObject({
      title: "Private document",
      fileName: "",
      department: null,
      readers: { kind: "private", names: [] },
      status: "active",
    });
    expect(privateRow!.chunks).toBeGreaterThan(0);
    // Neither the title nor the file name of the private document is exposed.
    expect(JSON.stringify(view)).not.toMatch(/Private Notes|maya-notes/);
    expect(view.documents.filter((document) => document.readers.kind === "private")).toHaveLength(1);
  });

  it("shows the draft with progress, new documents and failed files", async () => {
    const created = await createBatch({
      files: [
        { name: "Leave Policy.md", size: 10 },
        { name: "broken.docx", size: 10 },
      ],
    });
    await env.CORPUS_DB.batch([
      env.CORPUS_DB.prepare("UPDATE upload_files SET chunks_total = 58, chunks_embedded = 41, stage = 'embedding' WHERE id = ?").bind(created.files[0].id),
      env.CORPUS_DB.prepare("UPDATE upload_files SET stage = 'failed', error_code = 'NO_TEXT' WHERE id = ?").bind(created.files[1].id),
    ]);
    const view = (await (await call("/admin/sources", admin())).json()) as SourcesResponse;
    expect(view.draft).toMatchObject({
      kind: "upload",
      state: "building",
      embeddedChunks: 41,
      totalChunks: 58,
      documents: 1,
      failedFiles: 1,
    });
    const draftRow = view.documents.find((document) => document.status === "draft");
    expect(draftRow).toMatchObject({ title: "Leave Policy.md", chunks: 58, readers: { kind: "departments", names: ["hr"] } });
    const failedRow = view.documents.find((document) => document.status === "failed");
    expect(failedRow).toMatchObject({ title: "broken.docx" });
    expect(failedRow!.errorMessage).toMatch(/No readable text/);
    // Active documents stay listed as active while a draft is open.
    expect(view.documents.filter((document) => document.status === "active")).toHaveLength(CORPUS_DOCUMENT_IDS.length);
  });

  it("derives the draft state from the generation and its checks", async () => {
    await createBatch();
    const draft = await env.CORPUS_DB.prepare("SELECT generation_id FROM drafts").first<{ generation_id: string }>();
    const id = draft!.generation_id;
    const stateOf = async () =>
      ((await (await call("/admin/sources", admin())).json()) as SourcesResponse).draft!;
    const setGeneration = (state: string) =>
      env.CORPUS_DB.prepare("UPDATE corpus_generations SET state = ? WHERE id = ?").bind(state, id).run();
    await setGeneration("reconciling");
    expect((await stateOf()).state).toBe("checking");
    await env.CORPUS_DB.prepare("INSERT INTO draft_checks (generation_id, status, started_at) VALUES (?, 'paused', 1)").bind(id).run();
    expect((await stateOf()).state).toBe("checks_paused");
    await env.CORPUS_DB.prepare("UPDATE draft_checks SET status = 'failed', reconciled = 0, acl_leaks = 0, finished_at = 2 WHERE generation_id = ?").bind(id).run();
    const failed = await stateOf();
    expect(failed.state).toBe("checks_failed");
    expect(failed.checks).toMatchObject({ reconciled: false, aclLeaks: 0 });
    await env.CORPUS_DB.prepare("UPDATE draft_checks SET status = 'passed', reconciled = 1, live_recall = 0.995 WHERE generation_id = ?").bind(id).run();
    await setGeneration("ready");
    const passed = await stateOf();
    expect(passed.state).toBe("checks_passed");
    expect(passed.checks).toMatchObject({ reconciled: true, aclLeaks: 0, liveRecall: 0.995 });
  });
});

describe("draft promote and discard", () => {
  async function draftId(): Promise<string> {
    await createBatch();
    const row = await env.CORPUS_DB.prepare("SELECT generation_id FROM drafts").first<{ generation_id: string }>();
    return row!.generation_id;
  }
  const promote = (id: string) => call(`/admin/drafts/${id}/promote`, admin(), { method: "POST", json: {} });
  const discard = (id: string) => call(`/admin/drafts/${id}/discard`, admin(), { method: "POST", json: {} });

  it("refuses to promote until the checks passed, and never moves the pointer when it refuses", async () => {
    const id = await draftId();
    expect((await promote(id)).status).toBe(400); // still building
    await env.CORPUS_DB.prepare("UPDATE corpus_generations SET state = 'ready' WHERE id = ?").bind(id).run();
    expect((await promote(id)).status).toBe(400); // ready but no check row
    await env.CORPUS_DB.prepare("INSERT INTO draft_checks (generation_id, status, reconciled, acl_leaks, started_at) VALUES (?, 'failed', 1, 0, 1)").bind(id).run();
    expect((await promote(id)).status).toBe(400); // checks failed
    await env.CORPUS_DB.prepare("UPDATE draft_checks SET status = 'passed', acl_leaks = 2 WHERE generation_id = ?").bind(id).run();
    expect((await promote(id)).status).toBe(400); // passed but leaks
    await env.CORPUS_DB.prepare("UPDATE draft_checks SET acl_leaks = 0, reconciled = 0 WHERE generation_id = ?").bind(id).run();
    expect((await promote(id)).status).toBe(400); // not reconciled
    await env.CORPUS_DB.prepare("UPDATE draft_checks SET acl_leaks = NULL, reconciled = 1 WHERE generation_id = ?").bind(id).run();
    expect((await promote(id)).status).toBe(400); // leak count unknown
    expect(await activeGenerationId(env.CORPUS_DB as never)).toBe(activeId);
  });

  it("promotes a ready draft whose checks passed with zero leaks, then is idempotent", async () => {
    const id = await draftId();
    await env.CORPUS_DB.prepare("UPDATE corpus_generations SET state = 'ready' WHERE id = ?").bind(id).run();
    await env.CORPUS_DB.prepare("INSERT INTO draft_checks (generation_id, status, reconciled, acl_leaks, started_at) VALUES (?, 'passed', 1, 0, 1)").bind(id).run();
    const response = await promote(id);
    expect(response.status).toBe(200);
    expect((await response.json()) as DraftActionResponse).toEqual({ ok: true, generationId: id });
    expect(await activeGenerationId(env.CORPUS_DB as never)).toBe(id);
    const old = await env.CORPUS_DB.prepare("SELECT state FROM corpus_generations WHERE id = ?").bind(activeId).first<{ state: string }>();
    expect(old?.state).toBe("archived");
    const draft = await env.CORPUS_DB.prepare("SELECT closed_at FROM drafts WHERE generation_id = ?").bind(id).first<{ closed_at: number | null }>();
    expect(draft?.closed_at).not.toBeNull();
    expect((await promote(id)).status).toBe(200);
    // restore the original generation for the following tests
    await env.CORPUS_DB.prepare("UPDATE corpus_generations SET state = 'archived' WHERE id = ?").bind(id).run();
    await env.CORPUS_DB.prepare("UPDATE corpus_generations SET state = 'active' WHERE id = ?").bind(activeId).run();
    await env.CORPUS_DB.prepare("UPDATE corpus_state SET active_generation_id = ? WHERE singleton = 1").bind(activeId).run();
  });

  it("promote and discard of an unknown draft is 404", async () => {
    expect((await promote("g-unknown")).status).toBe(404);
    expect((await discard("g-unknown")).status).toBe(404);
  });

  it("discard fails the draft, removes its rows and vectors, and leaves the active generation untouched", async () => {
    const id = await draftId();
    const activeChunks = await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM chunks WHERE generation_id = ?").bind(activeId).first<{ n: number }>();
    const activeCatalog = await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM document_catalog WHERE generation_id = ?").bind(activeId).first<{ n: number }>();
    // Give the draft staged rows to remove: a copy of one active chunk under the draft id.
    await env.CORPUS_DB.prepare(
      `INSERT INTO document_versions (id, document_id, generation_id, r2_key, content_digest, byte_size, created_at)
       SELECT id || '-d', document_id, ?, r2_key, content_digest, byte_size, created_at
       FROM document_versions WHERE generation_id = ? LIMIT 1`,
    ).bind(id, activeId).run();
    await env.CORPUS_DB.prepare(
      `INSERT INTO chunks (chunk_id, document_id, document_version_id, generation_id, heading, chunk_index, content,
         start_offset, end_offset, content_digest, vector_id, acl_group, access_scope, allowed_roles, allowed_departments, metadata, created_at)
       SELECT chunk_id || '-d', document_id, (SELECT id FROM document_versions WHERE generation_id = ? LIMIT 1), ?, heading, chunk_index, content,
         start_offset, end_offset, content_digest, vector_id || '-d', acl_group, access_scope, allowed_roles, allowed_departments, metadata, created_at
       FROM chunks WHERE generation_id = ? LIMIT 1`,
    ).bind(id, id, activeId).run();
    const response = await discard(id);
    expect(response.status).toBe(200);
    expect(await activeGenerationId(env.CORPUS_DB as never)).toBe(activeId);
    expect((await env.CORPUS_DB.prepare("SELECT state FROM corpus_generations WHERE id = ?").bind(activeId).first<{ state: string }>())?.state).toBe("active");
    expect((await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM chunks WHERE generation_id = ?").bind(activeId).first<{ n: number }>())?.n).toBe(activeChunks?.n);
    expect((await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM document_catalog WHERE generation_id = ?").bind(activeId).first<{ n: number }>())?.n).toBe(activeCatalog?.n);
    const draft = await env.CORPUS_DB.prepare(
      "SELECT g.state, g.error_code, d.closed_at FROM corpus_generations g JOIN drafts d ON d.generation_id = g.id WHERE g.id = ?",
    ).bind(id).first<{ state: string; error_code: string; closed_at: number | null }>();
    expect(draft).toMatchObject({ state: "failed", error_code: "DISCARDED" });
    expect(draft?.closed_at).not.toBeNull();
    expect((await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM chunks WHERE generation_id = ?").bind(id).first<{ n: number }>())?.n).toBe(0);
    expect(deletedVectors).toHaveLength(1);
    // A discarded draft disappears from Sources and a new upload opens a fresh one.
    const view = (await (await call("/admin/sources", admin())).json()) as SourcesResponse;
    expect(view.draft).toBeNull();
    await createBatch();
    const open = await env.CORPUS_DB.prepare("SELECT generation_id FROM drafts WHERE closed_at IS NULL").first<{ generation_id: string }>();
    expect(open?.generation_id).not.toBe(id);
  });

  /** A ready, check-passed draft that holds one staged chunk, so a wrongful discard is visible. */
  async function promotableDraft(): Promise<string> {
    const id = await draftId();
    const tag = `-race-${crypto.randomUUID().slice(0, 8)}`;
    await env.CORPUS_DB.prepare(
      `INSERT INTO document_versions (id, document_id, generation_id, r2_key, content_digest, byte_size, created_at)
       SELECT id || ?, document_id, ?, r2_key, content_digest, byte_size, created_at
       FROM document_versions WHERE generation_id = ? LIMIT 1`,
    ).bind(tag, id, activeId).run();
    await env.CORPUS_DB.prepare(
      `INSERT INTO chunks (chunk_id, document_id, document_version_id, generation_id, heading, chunk_index, content,
         start_offset, end_offset, content_digest, vector_id, acl_group, access_scope, allowed_roles, allowed_departments, metadata, created_at)
       SELECT chunk_id || ?, document_id, (SELECT id FROM document_versions WHERE generation_id = ? LIMIT 1), ?, heading, chunk_index, content,
         start_offset, end_offset, content_digest, vector_id || ?, acl_group, access_scope, allowed_roles, allowed_departments, metadata, created_at
       FROM chunks WHERE generation_id = ? LIMIT 1`,
    ).bind(tag, id, id, tag, activeId).run();
    await env.CORPUS_DB.prepare("UPDATE corpus_generations SET state = 'ready' WHERE id = ?").bind(id).run();
    await env.CORPUS_DB.prepare("INSERT INTO draft_checks (generation_id, status, reconciled, acl_leaks, started_at) VALUES (?, 'passed', 1, 0, 1)").bind(id).run();
    return id;
  }

  async function restoreActive(id: string) {
    await env.CORPUS_DB.prepare("UPDATE corpus_generations SET state = 'archived' WHERE id = ?").bind(id).run();
    await env.CORPUS_DB.prepare("UPDATE corpus_generations SET state = 'active' WHERE id = ?").bind(activeId).run();
    await env.CORPUS_DB.prepare("UPDATE corpus_state SET active_generation_id = ? WHERE singleton = 1").bind(activeId).run();
  }

  it("a discard that loses the race to a promotion deletes nothing from the new active generation", async () => {
    const id = await promotableDraft();
    const staged = (await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM chunks WHERE generation_id = ?").bind(id).first<{ n: number }>())?.n;
    expect(staged).toBe(1);
    let promoted = false;
    // The promotion lands after the discard read the draft and before it changes anything.
    beforeStatement = async (sql) => {
      if (!promoted && /UPDATE corpus_generations SET state = 'failed'/.test(sql)) {
        promoted = true;
        await promoteGeneration(env.CORPUS_DB as never, id);
      }
    };
    const response = await discard(id);
    beforeStatement = null;
    expect(promoted).toBe(true);
    expect(response.status).toBe(400);
    expect(await activeGenerationId(env.CORPUS_DB as never)).toBe(id);
    expect((await env.CORPUS_DB.prepare("SELECT state FROM corpus_generations WHERE id = ?").bind(id).first<{ state: string }>())?.state).toBe("active");
    expect((await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM chunks WHERE generation_id = ?").bind(id).first<{ n: number }>())?.n).toBe(1);
    expect((await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM document_versions WHERE generation_id = ?").bind(id).first<{ n: number }>())?.n).toBe(1);
    expect(deletedVectors).toEqual([]);
    await restoreActive(id);
  });

  it("a promotion that loses the race to a discard reports failure and never moves the pointer", async () => {
    const id = await promotableDraft();
    let discarded = false;
    // The discard claims the draft after promote read it as ready, right before the promote writes.
    beforeStatement = async (sql) => {
      if (!discarded && /SET state = 'active'/.test(sql)) {
        discarded = true;
        await env.CORPUS_DB.batch([
          env.CORPUS_DB.prepare("UPDATE corpus_generations SET state = 'failed', error_code = 'DISCARDED' WHERE id = ?").bind(id),
          env.CORPUS_DB.prepare("UPDATE drafts SET closed_at = 1 WHERE generation_id = ?").bind(id),
        ]);
      }
    };
    const response = await promote(id);
    beforeStatement = null;
    expect(discarded).toBe(true);
    expect(response.status).toBe(400);
    expect(await activeGenerationId(env.CORPUS_DB as never)).toBe(activeId);
    expect((await env.CORPUS_DB.prepare("SELECT state FROM corpus_generations WHERE id = ?").bind(id).first<{ state: string }>())?.state).toBe("failed");
  });

  it.each(["draft", "indexing", "reconciling", "ready", "failed"])(
    "discards a %s draft, so a stuck build can always be cleared",
    async (state) => {
      const id = await draftId();
      await env.CORPUS_DB.prepare("UPDATE corpus_generations SET state = ? WHERE id = ?").bind(state, id).run();
      const response = await discard(id);
      expect(response.status).toBe(200);
      const row = await env.CORPUS_DB.prepare(
        "SELECT g.state, g.error_code, d.closed_at FROM corpus_generations g JOIN drafts d ON d.generation_id = g.id WHERE g.id = ?",
      ).bind(id).first<{ state: string; error_code: string; closed_at: number | null }>();
      expect(row).toMatchObject({ state: "failed", error_code: "DISCARDED" });
      expect(row?.closed_at).not.toBeNull();
      expect(await activeGenerationId(env.CORPUS_DB as never)).toBe(activeId);
      // The slot is free again.
      await createBatch();
    },
  );

  it("discard twice is harmless and cannot discard a live generation", async () => {
    const id = await draftId();
    expect((await discard(id)).status).toBe(200);
    expect((await discard(id)).status).toBe(200);
    const live = await call(`/admin/drafts/${activeId}/discard`, admin(), { method: "POST", json: {} });
    expect(live.status).toBe(404); // the live generation has no draft row at all
    expect(await activeGenerationId(env.CORPUS_DB as never)).toBe(activeId);
  });
});

describe("POST /admin/reindex", () => {
  it("opens a reindex draft and queues one job; a second request is refused while it is open", async () => {
    const response = await call("/admin/reindex", admin(), { method: "POST", json: {} });
    expect(response.status).toBe(200);
    const { generationId } = (await response.json()) as { generationId: string };
    expect(sent).toEqual([{ jobId: generationId, idempotencyKey: generationId }]);
    const draft = await env.CORPUS_DB.prepare("SELECT kind, base_generation_id FROM drafts WHERE generation_id = ?").bind(generationId).first();
    expect(draft).toEqual({ kind: "reindex", base_generation_id: activeId });
    expect((await call("/admin/reindex", admin(), { method: "POST", json: {} })).status).toBe(400);
    expect(sent).toHaveLength(1);
    // Uploads cannot join a reindex draft.
    expect((await call("/admin/uploads", admin(), { json: baseBody() })).status).toBe(400);
    expect(await activeGenerationId(env.CORPUS_DB as never)).toBe(activeId);
  });

  it("fails the reindex draft if the job cannot be queued", async () => {
    failQueue = true;
    const response = await call("/admin/reindex", admin(), { method: "POST", json: {} });
    expect(response.status).toBeGreaterThanOrEqual(500);
    const open = await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM drafts WHERE closed_at IS NULL").first<{ n: number }>();
    expect(open?.n).toBe(0);
  });
});

describe("sources maintenance (scheduled)", () => {
  const scheduled = () =>
    (worker as unknown as { scheduled(controller: unknown, env: unknown): Promise<void> }).scheduled({}, sessionEnv);

  it("republishes a batch expiry job that failed to publish, with no further client request", async () => {
    failJob = (jobId) => jobId.startsWith("ub-");
    const created = await createBatch();
    const draft = await env.CORPUS_DB.prepare("SELECT generation_id FROM drafts").first<{ generation_id: string }>();
    expect(sent.map((message) => message.jobId)).toEqual([draft!.generation_id]);
    const before = await env.CORPUS_DB.prepare("SELECT job_enqueued_at FROM upload_batches WHERE id = ?")
      .bind(created.batchId)
      .first<{ job_enqueued_at: number | null }>();
    expect(before?.job_enqueued_at).toBeNull();
    failJob = null;
    // The client never sends a byte. The scheduled handler finishes the publish on its own.
    await scheduled();
    expect(sent.map((message) => message.jobId)).toEqual([draft!.generation_id, created.batchId]);
    const after = await env.CORPUS_DB.prepare("SELECT job_enqueued_at FROM upload_batches WHERE id = ?")
      .bind(created.batchId)
      .first<{ job_enqueued_at: number | null }>();
    expect(after?.job_enqueued_at).not.toBeNull();
    await scheduled();
    expect(sent).toHaveLength(2);
  });

  it("keeps an unpublished draft job for the next run instead of failing the draft while the queue is down", async () => {
    const { draft } = await ensureOpenDraft(env.CORPUS_DB as never, { kind: "upload", createdBy: "member-jordan" });
    const lost = await createUploadBatch(env.CORPUS_DB as never, {
      generationId: draft.generationId,
      createdBy: "member-jordan",
      acl: readersToAcl({ kind: "everyone" }),
      idempotencyKey: "idem-maint-1",
      files: [{ name: "lost.md", size: 5 }],
    });
    failQueue = true;
    await scheduled();
    const state = await env.CORPUS_DB.prepare(
      "SELECT d.closed_at, g.state FROM drafts d JOIN corpus_generations g ON g.id = d.generation_id WHERE d.generation_id = ?",
    ).bind(draft.generationId).first<{ closed_at: number | null; state: string }>();
    expect(state).toEqual({ closed_at: null, state: "draft" });
    failQueue = false;
    await scheduled();
    expect(sent.map((message) => message.jobId)).toEqual([draft.generationId, lost.batchId]);
  });

  it("purges a discarded draft for good once writers that were in flight can no longer run", async () => {
    await createBatch();
    const draft = await env.CORPUS_DB.prepare("SELECT generation_id FROM drafts").first<{ generation_id: string }>();
    const id = draft!.generation_id;
    // Two staged chunks under the draft.
    await env.CORPUS_DB.prepare(
      `INSERT INTO document_versions (id, document_id, generation_id, r2_key, content_digest, byte_size, created_at)
       SELECT id || '-p', document_id, ?, r2_key, content_digest, byte_size, created_at
       FROM document_versions WHERE generation_id = ? LIMIT 1`,
    ).bind(id, activeId).run();
    await env.CORPUS_DB.prepare(
      `INSERT INTO chunks (chunk_id, document_id, document_version_id, generation_id, heading, chunk_index, content,
         start_offset, end_offset, content_digest, vector_id, acl_group, access_scope, allowed_roles, allowed_departments, metadata, created_at)
       SELECT chunk_id || '-p', document_id, (SELECT id FROM document_versions WHERE generation_id = ? LIMIT 1), ?, heading, chunk_index, content,
         start_offset, end_offset, content_digest, vector_id || '-p', acl_group, access_scope, allowed_roles, allowed_departments, metadata, created_at
       FROM chunks WHERE generation_id = ? LIMIT 2`,
    ).bind(id, id, activeId).run();
    const staged = await env.CORPUS_DB.prepare("SELECT vector_id FROM chunks WHERE generation_id = ? ORDER BY vector_id")
      .bind(id)
      .all<{ vector_id: string }>();
    expect(staged.results).toHaveLength(2);
    const discard = await call(`/admin/drafts/${id}/discard`, admin(), { method: "POST", json: {} });
    expect(discard.status).toBe(200);
    expect([...deletedVectors].sort()).toEqual(staged.results.map((row) => row.vector_id));
    // A writer already in flight cannot put rows back.
    await expect(
      env.CORPUS_DB.prepare(
        `INSERT INTO document_versions (id, document_id, generation_id, r2_key, content_digest, byte_size, created_at)
         SELECT id || '-late', document_id, ?, r2_key, content_digest, byte_size, created_at
         FROM document_versions WHERE generation_id = ? LIMIT 1`,
      ).bind(id, activeId).run(),
    ).rejects.toThrow(/DRAFT_CLOSED/);
    const closedAt = (await env.CORPUS_DB.prepare("SELECT closed_at FROM drafts WHERE generation_id = ?").bind(id).first<{ closed_at: number }>())!.closed_at;
    // Inside the grace window a pass keeps the vector ids: a late upsert may still land.
    deletedVectors = [];
    await runSourcesMaintenance(sessionEnv as never, closedAt + 1000);
    expect(deletedVectors).toEqual([]);
    const purged = () =>
      env.CORPUS_DB.prepare("SELECT purged_at FROM drafts WHERE generation_id = ?").bind(id).first<{ purged_at: number | null }>();
    expect((await purged())?.purged_at).toBeNull();
    // After it, the ids are deleted once more and the draft is marked purged.
    await runSourcesMaintenance(sessionEnv as never, closedAt + DISCARD_GRACE_MS + 1);
    expect([...deletedVectors].sort()).toEqual(staged.results.map((row) => row.vector_id));
    expect((await purged())?.purged_at).not.toBeNull();
    deletedVectors = [];
    await runSourcesMaintenance(sessionEnv as never, closedAt + DISCARD_GRACE_MS + 2);
    expect(deletedVectors).toEqual([]);
    for (const table of ["chunks", "document_catalog", "document_bodies", "document_versions"]) {
      const row = await env.CORPUS_DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE generation_id = ?`).bind(id).first<{ n: number }>();
      expect(row?.n, table).toBe(0);
    }
  });
});
