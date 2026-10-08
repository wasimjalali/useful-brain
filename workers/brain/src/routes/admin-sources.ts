import { requireAdmin } from "../../../../src/lib/auth/admin";
import type { DirectoryRecord } from "../../../../src/lib/auth/principal";
import { BoundedIdError, parseBoundedId } from "../../../../src/lib/cf/bounded-id";
import { writeOperationalLog } from "../../../../src/lib/cf/operational-log";
import { withRequestId } from "../../../../src/lib/cf/request-id";
import { WorkerNotFoundError, WorkerValidationError } from "../../../../src/lib/cf/worker-errors";
import type {
  DraftActionResponse,
  ReindexResponse,
  UploadFileAccepted,
} from "../../../../src/lib/contracts/sources";
import { deleteVectors, type VectorPort } from "../../../../src/lib/ingest/draft-index";
import {
  parseUploadRequest,
  readersToAcl,
  MAX_UPLOAD_BYTES,
} from "../../../../src/lib/ingest/upload-validation";
import { activeGenerationId, getGeneration, promoteGeneration, type SqlExecutor } from "../../../../src/lib/store/corpus-d1";
import {
  assertAcceptsUploads,
  claimDiscard,
  closeDraft,
  draftAcceptsWrites,
  ensureOpenDraft,
  failDraft,
  getDraft,
  markJobPublished,
  unpublishedJobIds,
} from "../../../../src/lib/store/drafts";
import { GenerationTransitionError } from "../../../../src/lib/store/generations";
import { buildSourcesView } from "../../../../src/lib/store/sources-view";
import {
  createUploadBatch,
  getUploadBatch,
  getUploadFile,
  getUploadStatus,
  recordUploadedObject,
  resolveUploadReplay,
} from "../../../../src/lib/store/uploads";

type QueueLike = { send(message: { jobId: string; idempotencyKey: string }): Promise<void> };
type BucketLike = {
  put(key: string, value: ReadableStream, options?: unknown): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
};

export type SourcesEnv = {
  CORPUS_DB?: unknown;
  VECTORIZE?: unknown;
  SOURCES?: BucketLike;
  INGEST_QUEUE?: QueueLike;
};

const MAX_JSON_BYTES = 64 * 1024;

function json(body: unknown, requestId: string, status = 200): Response {
  const response = Response.json(body, { status, headers: withRequestId(new Headers(), requestId) });
  response.headers.set("cache-control", "no-store");
  return response;
}

function boundedId(value: string, label: string): string {
  try {
    return parseBoundedId(decodeURIComponent(value), label);
  } catch (error) {
    if (error instanceof BoundedIdError || error instanceof URIError) {
      throw new WorkerNotFoundError();
    }
    throw error;
  }
}

async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_JSON_BYTES) {
    throw new WorkerValidationError();
  }
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) {
    throw new WorkerValidationError();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WorkerValidationError();
  }
}

function requireCorpus(env: SourcesEnv): SqlExecutor {
  if (!env.CORPUS_DB) {
    throw new Error("CORPUS_DB is not bound");
  }
  return env.CORPUS_DB as SqlExecutor;
}

function requireQueue(env: SourcesEnv): QueueLike {
  if (!env.INGEST_QUEUE) {
    throw new Error("INGEST_QUEUE is not bound");
  }
  return env.INGEST_QUEUE;
}

/** Queue messages carry identifiers only; the id is also the deterministic workflow instance id. */
async function enqueueJob(queue: QueueLike, id: string): Promise<void> {
  await queue.send({ jobId: id, idempotencyKey: id });
}

/**
 * Publishes the jobs of a draft that never reached the queue. The rows exist
 * before anything is published and a job is marked only after the queue took it,
 * so a crash between the two leaves the intent for the next request to finish.
 * The draft job is mandatory: if it cannot be queued the draft is failed so it
 * does not sit forever. A batch's expiry job is only a safety net for files that
 * never arrive, so a failure there is logged and retried on the next request.
 * Publishing twice is harmless: the workflow instance id is the job id.
 */
async function publishPendingJobs(
  corpus: SqlExecutor,
  queue: QueueLike,
  generationId: string,
  log: { requestId: string; started: number },
): Promise<void> {
  for (const jobId of await unpublishedJobIds(corpus, generationId)) {
    try {
      await enqueueJob(queue, jobId);
    } catch (error) {
      if (jobId === generationId) {
        await failDraft(corpus, generationId, "ENQUEUE_FAILED");
        throw error;
      }
      writeOperationalLog({
        requestId: log.requestId,
        operation: "admin-uploads-expiry-enqueue",
        status: "error",
        durationMs: Date.now() - log.started,
        errorCode: "ENQUEUE_FAILED",
      });
      continue;
    }
    await markJobPublished(corpus, generationId, jobId);
  }
}

function r2KeyFor(generationId: string, batchId: string, fileId: string): string {
  return `uploads/${generationId}/${batchId}/${fileId}`;
}

/**
 * Sources, uploads and the draft pipeline. Admin only: index.ts gates `/admin/`
 * before dispatch and every handler here asserts it again. Returns null for
 * paths it does not own.
 */
export async function handleAdminSourcesRoute(input: {
  request: Request;
  path: string;
  env: SourcesEnv;
  principal: DirectoryRecord;
  requestId: string;
  started: number;
}): Promise<Response | null> {
  const { request, path, env, principal, requestId, started } = input;
  const method = request.method;
  const putFile = path.match(/^\/admin\/uploads\/([^/]+)\/files\/([^/]+)$/);
  const batchStatus = path.match(/^\/admin\/uploads\/([^/]+)$/);
  const draftAction = path.match(/^\/admin\/drafts\/([^/]+)\/(promote|discard)$/);
  const owned =
    (path === "/admin/uploads" && method === "POST") ||
    (putFile && method === "PUT") ||
    (batchStatus && method === "GET") ||
    (path === "/admin/sources" && method === "GET") ||
    (draftAction && method === "POST") ||
    (path === "/admin/reindex" && method === "POST");
  if (!owned) {
    return null;
  }
  requireAdmin(principal);
  const done = (operation: string) =>
    writeOperationalLog({
      requestId,
      principalKind: principal.kind,
      operation,
      status: "ok",
      durationMs: Date.now() - started,
    });
  const corpus = requireCorpus(env);

  if (path === "/admin/sources") {
    const view = await buildSourcesView(corpus);
    done("admin-sources");
    return json(view, requestId);
  }

  if (path === "/admin/uploads") {
    const body = parseUploadRequest(await readJson(request));
    const acl = readersToAcl(body.readers);
    const queue = requireQueue(env);
    const request_ = { createdBy: principal.id, acl, idempotencyKey: body.idempotencyKey, files: body.files };
    // A replay is answered from what it created. It never opens a draft or
    // queues a job of its own; it only finishes a publish the first attempt lost.
    const replay = await resolveUploadReplay(corpus, request_);
    if (replay) {
      await publishPendingJobs(corpus, queue, replay.generationId, { requestId, started });
      done("admin-uploads-replay");
      return json({ batchId: replay.batchId, files: replay.files }, requestId);
    }
    const { draft } = await ensureOpenDraft(corpus, { kind: "upload", createdBy: principal.id });
    assertAcceptsUploads(draft);
    // Rows first, queue second: a job must never start before the files it waits for exist.
    const batch = await createUploadBatch(corpus, { generationId: draft.generationId, ...request_ });
    await publishPendingJobs(corpus, queue, draft.generationId, { requestId, started });
    done("admin-uploads-create");
    return json(batch, requestId);
  }

  if (putFile) {
    const batchId = boundedId(putFile[1], "batch id");
    const fileId = boundedId(putFile[2], "file id");
    const file = await getUploadFile(corpus, fileId);
    const batch = file && file.batch_id === batchId ? await getUploadBatch(corpus, batchId) : null;
    if (!file || !batch) {
      throw new WorkerNotFoundError();
    }
    const declared = Number(request.headers.get("content-length") ?? "");
    if (
      !Number.isInteger(declared) ||
      declared !== file.byte_size ||
      declared < 1 ||
      declared > MAX_UPLOAD_BYTES ||
      !request.body ||
      file.stage !== "parsing" ||
      !(await draftAcceptsWrites(corpus, batch.generation_id))
    ) {
      throw new WorkerValidationError();
    }
    if (!env.SOURCES) {
      throw new Error("SOURCES is not bound");
    }
    const queue = requireQueue(env);
    const key = r2KeyFor(batch.generation_id, batchId, fileId);
    // A fixed-length stream gives R2 the length up front without buffering the
    // body, and errors if the body is shorter or longer than declared.
    const { readable, writable } = new FixedLengthStream(declared);
    const pump = request.body.pipeTo(writable);
    pump.catch(() => undefined);
    try {
      const stored = await env.SOURCES.put(key, readable, {
        httpMetadata: { contentType: "application/octet-stream" },
      });
      await pump;
      if (!stored || stored.size !== declared) {
        throw new WorkerValidationError();
      }
    } catch (error) {
      await env.SOURCES.delete(key).catch(() => undefined);
      throw error instanceof WorkerValidationError ? error : new WorkerValidationError();
    }
    if (!(await recordUploadedObject(corpus, fileId, key))) {
      // The file expired or its draft closed while the bytes were streaming.
      await env.SOURCES.delete(key).catch(() => undefined);
      throw new WorkerValidationError();
    }
    await publishPendingJobs(corpus, queue, batch.generation_id, { requestId, started });
    await enqueueJob(queue, fileId);
    done("admin-uploads-put");
    return json({ ok: true, stage: "parsing" } satisfies UploadFileAccepted, requestId);
  }

  if (batchStatus) {
    const status = await getUploadStatus(corpus, boundedId(batchStatus[1], "batch id"));
    done("admin-uploads-status");
    return json(status, requestId);
  }

  if (path === "/admin/reindex") {
    const queue = requireQueue(env);
    if (!(await activeGenerationId(corpus))) {
      throw new WorkerValidationError();
    }
    const { draft, created } = await ensureOpenDraft(corpus, { kind: "reindex", createdBy: principal.id });
    if (!created) {
      throw new WorkerValidationError("A draft is already open. Promote or discard it first.");
    }
    await publishPendingJobs(corpus, queue, draft.generationId, { requestId, started });
    done("admin-reindex");
    return json({ ok: true, generationId: draft.generationId } satisfies ReindexResponse, requestId);
  }

  // /admin/drafts/:id/(promote|discard)
  const generationId = boundedId(draftAction![1], "draft id");
  const draft = await getDraft(corpus, generationId);
  if (!draft) {
    throw new WorkerNotFoundError();
  }
  const generation = await getGeneration(corpus, generationId);

  if (draftAction![2] === "promote") {
    if (generation?.state === "active") {
      // A previous promote landed but the draft row was not closed yet.
      await closeDraft(corpus, generationId);
      return json({ ok: true, generationId } satisfies DraftActionResponse, requestId);
    }
    const checks = await corpus
      .prepare(`SELECT status, reconciled, acl_leaks FROM draft_checks WHERE generation_id = ?`)
      .bind(generationId)
      .first<{ status: string; reconciled: number; acl_leaks: number | null }>();
    if (
      draft.closedAt !== null ||
      generation?.state !== "ready" ||
      checks?.status !== "passed" ||
      checks.reconciled !== 1 ||
      checks.acl_leaks !== 0
    ) {
      throw new WorkerValidationError("This draft hasn't passed its checks.");
    }
    try {
      await promoteGeneration(corpus, generationId);
    } catch (error) {
      if (error instanceof GenerationTransitionError) {
        throw new WorkerValidationError("This draft hasn't passed its checks.");
      }
      throw error;
    }
    // The promotion is conditional on the draft still being ready, so a discard
    // that landed first leaves it a no-op. Only report success if it took effect.
    if ((await activeGenerationId(corpus)) !== generationId) {
      throw new WorkerValidationError("This draft hasn't passed its checks.");
    }
    await closeDraft(corpus, generationId);
    done("admin-draft-promote");
    return json({ ok: true, generationId } satisfies DraftActionResponse, requestId);
  }

  // discard: claim the draft atomically, then remove what it holds. Nothing is
  // deleted unless the claim succeeded, so a promotion that wins the race (or a
  // live generation) is never touched. The claim also stops further writes.
  if (!(await claimDiscard(corpus, generationId))) {
    throw new WorkerValidationError();
  }
  const vectorIds = await corpus
    .prepare(`SELECT vector_id FROM chunks WHERE generation_id = ?`)
    .bind(generationId)
    .all<{ vector_id: string }>();
  await deleteVectors(
    { db: corpus, ai: null, vectors: (env.VECTORIZE as VectorPort | undefined) ?? null },
    generationId,
    vectorIds.results.map((row) => row.vector_id),
    Date.now(),
  );
  await corpus.batch([
    corpus.prepare(`DELETE FROM chunks WHERE generation_id = ?`).bind(generationId),
    corpus.prepare(`DELETE FROM document_catalog WHERE generation_id = ?`).bind(generationId),
    corpus.prepare(`DELETE FROM document_bodies WHERE generation_id = ?`).bind(generationId),
    corpus.prepare(`DELETE FROM document_versions WHERE generation_id = ?`).bind(generationId),
  ]);
  done("admin-draft-discard");
  return json({ ok: true, generationId } satisfies DraftActionResponse, requestId);
}
