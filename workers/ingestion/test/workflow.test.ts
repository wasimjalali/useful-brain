import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  introspectWorkflowInstance,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import worker from "../src";
import { readersToAcl } from "../../../src/lib/ingest/upload-validation";
import { activeGenerationId } from "../../../src/lib/store/corpus-d1";
import { ensureOpenDraft, failDraft } from "../../../src/lib/store/drafts";
import {
  advanceStage,
  createUploadBatch,
  getUploadFile,
  recordUploadedObject,
} from "../../../src/lib/store/uploads";
import { ACTIVE_DOCUMENTS, buildZip, db, docxBytes, resetPipeline, seedActive } from "./helpers";

beforeEach(resetPipeline);

async function runWorkflow(id: string): Promise<unknown> {
  await using instance = await introspectWorkflowInstance(env.INGESTION_WORKFLOW, id);
  await env.INGESTION_WORKFLOW.create({ id, params: { jobId: id, idempotencyKey: id } });
  await instance.waitForStatus("complete");
  return instance.getOutput();
}

const enc = (text: string) => new TextEncoder().encode(text);

type Setup = Awaited<ReturnType<typeof setup>>;

async function setup(
  files: Array<{ name: string; bytes: Uint8Array }>,
  readers: Parameters<typeof readersToAcl>[0] = { kind: "departments", names: ["hr"] },
) {
  const active = await seedActive();
  const { draft } = await ensureOpenDraft(db(), { kind: "upload", createdBy: "admin-test" });
  const batch = await createUploadBatch(db(), {
    generationId: draft.generationId,
    createdBy: "admin-test",
    acl: readersToAcl(readers),
    idempotencyKey: `batch-${crypto.randomUUID()}`,
    files: files.map((file) => ({ name: file.name, size: file.bytes.byteLength })),
  });
  for (const [index, created] of batch.files.entries()) {
    const key = `uploads/${draft.generationId}/${batch.batchId}/${created.id}`;
    await env.SOURCES.put(key, files[index].bytes);
    await recordUploadedObject(db(), created.id, key);
  }
  return { active, draft, batch };
}

async function stageOf(fileId: string) {
  return getUploadFile(db(), fileId);
}

async function chunkCount(generationId: string, documentId?: string): Promise<number> {
  const row = documentId
    ? await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM chunks WHERE generation_id = ? AND document_id = ?")
        .bind(generationId, documentId)
        .first<{ n: number }>()
    : await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM chunks WHERE generation_id = ?")
        .bind(generationId)
        .first<{ n: number }>();
  return row?.n ?? 0;
}

async function runDraftThenFiles(s: Setup) {
  await runWorkflow(s.draft.generationId);
  for (const file of s.batch.files) {
    await runWorkflow(file.id);
  }
}

describe("IngestionWorkflow job resolution", () => {
  it("ends without writing anything for an unknown job id", async () => {
    const output = await runWorkflow("no-such-job");
    expect(output).toMatchObject({ outcome: "unknown" });
    const generations = await env.CORPUS_DB.prepare("SELECT COUNT(*) AS n FROM drafts").first<{ n: number }>();
    expect(generations?.n).toBe(0);
  });

  it("does nothing for a file whose draft was discarded", async () => {
    const s = await setup([{ name: "late.md", bytes: enc("# Late\n\nwords") }]);
    await failDraft(db(), s.draft.generationId, "DISCARDED");
    const output = await runWorkflow(s.batch.files[0].id);
    expect(output).toMatchObject({ outcome: "closed" });
    expect(await chunkCount(s.draft.generationId)).toBe(0);
    expect((await stageOf(s.batch.files[0].id))?.stage).toBe("parsing");
  });
});

describe("upload pipeline", () => {
  it("copies the active generation into the draft, indexes the upload and reconciles keyword-only and stops at the missing retrieval model", async () => {
    const s = await setup([
      { name: "Leave Policy.md", bytes: enc("# Leave Policy\n\n## Parental leave\n\nSixteen weeks of paid leave for new parents.") },
    ]);
    const activeBefore = await activeGenerationId(db());
    const activeChunks = await chunkCount(s.active.generationId);

    await runDraftThenFiles(s);

    const file = await stageOf(s.batch.files[0].id);
    expect(file?.stage).toBe("ready");
    expect(file?.chunks_total).toBeGreaterThan(0);
    expect(file?.chunks_embedded).toBe(file?.chunks_total);

    // The draft holds the base copy plus the new document.
    const draftChunks = await chunkCount(s.draft.generationId);
    expect(draftChunks).toBe(activeChunks + (file?.chunks_total ?? 0));
    const catalog = await env.CORPUS_DB.prepare(
      "SELECT title, access_scope, allowed_departments FROM document_catalog WHERE generation_id = ? AND document_id = ?",
    )
      .bind(s.draft.generationId, file!.document_id)
      .first<{ title: string; access_scope: string; allowed_departments: string }>();
    expect(catalog).toEqual({ title: "Leave Policy", access_scope: "department", allowed_departments: '["hr"]' });

    // Nothing leaked into the live generation, and the pointer did not move.
    expect(await activeGenerationId(db())).toBe(activeBefore);
    expect(await chunkCount(s.active.generationId)).toBe(activeChunks);
    const liveCopy = await env.CORPUS_DB.prepare(
      "SELECT COUNT(*) AS n FROM document_catalog WHERE generation_id = ? AND document_id = ?",
    )
      .bind(s.active.generationId, file!.document_id)
      .first<{ n: number }>();
    expect(liveCopy?.n).toBe(0);

    // No Vectorize or AI is bound: reconcile passes as keyword-only, the retrieval guard cannot run, so the check fails closed.
    const checks = await env.CORPUS_DB.prepare(
      "SELECT status, reconciled, reconcile_mode, error_code, acl_leaks FROM draft_checks WHERE generation_id = ?",
    )
      .bind(s.draft.generationId)
      .first<Record<string, unknown>>();
    expect(checks).toMatchObject({
      status: "failed",
      reconciled: 1,
      reconcile_mode: "keyword_only",
      error_code: "RETRIEVAL_UNAVAILABLE",
      acl_leaks: 0,
    });
    const generation = await env.CORPUS_DB.prepare("SELECT state FROM corpus_generations WHERE id = ?")
      .bind(s.draft.generationId)
      .first<{ state: string }>();
    expect(generation?.state).toBe("reconciling");
  });

  it("records a bad file as failed with a closed code and keeps the good one", async () => {
    const bomb = await buildZip([{ name: "word/document.xml", data: new Uint8Array(30 * 1024 * 1024) }]);
    const s = await setup([
      { name: "bomb.docx", bytes: bomb },
      { name: "empty.md", bytes: enc("   ") },
      { name: "fine.md", bytes: enc("# Fine\n\nThis one is fine.") },
    ]);
    await runDraftThenFiles(s);
    const [bombRow, emptyRow, fineRow] = await Promise.all(s.batch.files.map((file) => stageOf(file.id)));
    expect(bombRow).toMatchObject({ stage: "failed", error_code: "ARCHIVE_TOO_LARGE" });
    expect(emptyRow).toMatchObject({ stage: "failed", error_code: "EMPTY_FILE" });
    expect(fineRow?.stage).toBe("ready");
    // A failed file never makes the draft fail: the good document is still in it.
    expect(await chunkCount(s.draft.generationId, fineRow!.document_id)).toBeGreaterThan(0);
    expect(await chunkCount(s.draft.generationId, bombRow!.document_id)).toBe(0);
  });

  it("processes a docx with headings", async () => {
    const bytes = await docxBytes([{ heading: 1, text: "Expense Policy" }, "Submit receipts within thirty days."]);
    const s = await setup([{ name: "expenses.docx", bytes }], { kind: "everyone" });
    await runDraftThenFiles(s);
    const row = await stageOf(s.batch.files[0].id);
    expect(row?.stage).toBe("ready");
    const catalog = await env.CORPUS_DB.prepare(
      "SELECT title, access_scope FROM document_catalog WHERE generation_id = ? AND document_id = ?",
    )
      .bind(s.draft.generationId, row!.document_id)
      .first<{ title: string; access_scope: string }>();
    expect(catalog).toEqual({ title: "Expense Policy", access_scope: "public" });
  });

  it("a missing R2 object fails the file instead of hanging it", async () => {
    const s = await setup([{ name: "ghost.md", bytes: enc("# G\n\nx") }]);
    await env.SOURCES.delete(`uploads/${s.draft.generationId}/${s.batch.batchId}/${s.batch.files[0].id}`);
    await runDraftThenFiles(s);
    expect(await stageOf(s.batch.files[0].id)).toMatchObject({ stage: "failed", error_code: "INTERNAL" });
  });

  it("a duplicate queue delivery of the same file job does not duplicate chunks", async () => {
    const s = await setup([{ name: "dup.md", bytes: enc("# Dup\n\nDuplicate delivery words.") }]);
    await runWorkflow(s.draft.generationId);
    const fileId = s.batch.files[0].id;
    const deliver = async (messageId: string, attempts: number) => {
      const batch = createMessageBatch("useful-brain-ingest-development", [
        { id: messageId, timestamp: new Date(), attempts, body: { jobId: fileId, idempotencyKey: `q-${fileId}` } },
      ]);
      const ctx = createExecutionContext();
      await worker.queue(batch, env, ctx);
      return getQueueResult(batch, ctx);
    };
    await using instance = await introspectWorkflowInstance(env.INGESTION_WORKFLOW, `q-${fileId}`);
    expect((await deliver("dup-1", 1)).explicitAcks).toEqual(["dup-1"]);
    await instance.waitForStatus("complete");
    const first = await chunkCount(s.draft.generationId);
    const second = await deliver("dup-2", 2);
    expect(second.explicitAcks).toEqual(["dup-2"]);
    expect(second.retryMessages).toEqual([]);
    expect(await chunkCount(s.draft.generationId)).toBe(first);
    expect(await getUploadFile(db(), fileId)).toMatchObject({ stage: "ready" });
  });

  it("a file already finished is a no-op for a fresh instance of the same job", async () => {
    const s = await setup([{ name: "again.md", bytes: enc("# Again\n\nSame file twice.") }]);
    await runDraftThenFiles(s);
    const before = await chunkCount(s.draft.generationId);
    // Different instance id, same file: the check step sees it is terminal.
    await using instance = await introspectWorkflowInstance(env.INGESTION_WORKFLOW, "replay-instance");
    await env.INGESTION_WORKFLOW.create({
      id: "replay-instance",
      params: { jobId: s.batch.files[0].id, idempotencyKey: "replay-instance" },
    });
    await instance.waitForStatus("complete");
    expect(await chunkCount(s.draft.generationId)).toBe(before);
  });
});

describe("failed build leaves the active generation unchanged", () => {
  it("a draft that fails keeps the pointer, state and rows of the live generation", async () => {
    const s = await setup([{ name: "doomed.md", bytes: enc("# Doomed\n\nwords words words") }]);
    await runDraftThenFiles(s);
    const pointer = await activeGenerationId(db());
    const liveBefore = await chunkCount(s.active.generationId);
    await failDraft(db(), s.draft.generationId, "TEST_FAILURE");
    expect(await activeGenerationId(db())).toBe(pointer);
    expect(await chunkCount(s.active.generationId)).toBe(liveBefore);
    const states = await env.CORPUS_DB.prepare("SELECT id, state FROM corpus_generations WHERE id IN (?, ?)")
      .bind(s.active.generationId, s.draft.generationId)
      .all<{ id: string; state: string }>();
    expect(Object.fromEntries(states.results.map((row) => [row.id, row.state]))).toEqual({
      [s.active.generationId]: "active",
      [s.draft.generationId]: "failed",
    });
  });
});

describe("stage progress", () => {
  it("only moves forward and ignores replays and stale writers", async () => {
    const s = await setup([{ name: "stages.md", bytes: enc("# S\n\nx") }]);
    const id = s.batch.files[0].id;
    expect(await advanceStage(db(), id, "chunking")).toBe(true);
    expect(await advanceStage(db(), id, "parsing")).toBe(false);
    expect(await advanceStage(db(), id, "chunking")).toBe(false);
    expect(await advanceStage(db(), id, "embedding")).toBe(true);
    expect(await advanceStage(db(), id, "chunking")).toBe(false);
    expect((await stageOf(id))?.stage).toBe("embedding");
  });
});

describe("reindex draft", () => {
  it("re-chunks every base document into a draft and leaves the live generation alone", async () => {
    const active = await seedActive();
    const { draft } = await ensureOpenDraft(db(), { kind: "reindex", createdBy: "admin-test" });
    const output = await runWorkflow(draft.generationId);
    expect(output).toMatchObject({ outcome: "draft" });
    const counts = await env.CORPUS_DB.prepare(
      "SELECT generation_id, COUNT(DISTINCT document_id) AS docs FROM chunks WHERE generation_id IN (?, ?) GROUP BY generation_id",
    )
      .bind(active.generationId, draft.generationId)
      .all<{ generation_id: string; docs: number }>();
    expect(Object.fromEntries(counts.results.map((row) => [row.generation_id, row.docs]))).toEqual({
      [active.generationId]: ACTIVE_DOCUMENTS.length,
      [draft.generationId]: ACTIVE_DOCUMENTS.length,
    });
    expect(await activeGenerationId(db())).toBe(active.generationId);
    const checks = await env.CORPUS_DB.prepare("SELECT status, error_code FROM draft_checks WHERE generation_id = ?")
      .bind(draft.generationId)
      .first<{ status: string; error_code: string }>();
    expect(checks).toEqual({ status: "failed", error_code: "RETRIEVAL_UNAVAILABLE" });
  });
});
