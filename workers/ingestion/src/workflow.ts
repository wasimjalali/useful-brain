import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import questionFixture from "../../../content/northwind/questions.json";
import { parseBoundedId, parseMutatingIdempotencyKey } from "../../../src/lib/cf/bounded-id";
import { isUploadErrorCode, UploadFailure } from "../../../src/lib/ingest/error-codes";
import type { UploadErrorCode } from "../../../src/lib/contracts/sources";
import {
  aclParityProbe,
  aggregateRecall,
  decideChecks,
  finishCheckRun,
  reconcileDraft,
  type ReconcileOutcome,
  reserveCheckRun,
  RETRIEVAL_BATCH,
  runRetrievalBatch,
  type AclProbeDocument,
  type EvalFixture,
  type RetrievalBatchResult,
} from "../../../src/lib/ingest/draft-checks";
import {
  copyBaseChunkPage,
  copyBaseDocuments,
  embedChunkRange,
  EMBED_RANGE,
  finalizeDocument,
  removeDocumentFromDraft,
  writeDocumentChunks,
  type DocumentToIndex,
  type IndexContext,
  type VectorPort,
} from "../../../src/lib/ingest/draft-index";
import { extractUploadText } from "../../../src/lib/ingest/extract";
import { MAX_UPLOAD_BYTES, uploadSourcePath } from "../../../src/lib/ingest/upload-validation";
import { acknowledgeIngestJob } from "../../../src/lib/ingest/queue-message";
import type { VectorizeIndex } from "../../../src/lib/retrieve/cloudflare-pipeline";
import type { SqlExecutor } from "../../../src/lib/store/corpus-d1";
import { draftAcceptsWrites, failDraft, getDraft, markBaseCopied } from "../../../src/lib/store/drafts";
import { claimFinalize, markDraftReady, startIndexing } from "../../../src/lib/store/draft-state";
import {
  advanceStage,
  batchAcl,
  expireUndeliveredFiles,
  failUploadFile,
  getUploadBatch,
  getUploadFile,
  markFileReady,
  setChunksEmbedded,
  setChunksTotal,
  UPLOAD_DELIVERY_TTL_MS,
} from "../../../src/lib/store/uploads";

export type IngestionWorkflowParams = {
  jobId: string;
  idempotencyKey: string;
};

const fixture = questionFixture as unknown as EvalFixture;

const STEP_CONFIG = {
  retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
  timeout: "10 minutes",
} as const;
const RECONCILE_CONFIG = {
  retries: { limit: 12, delay: "15 seconds", backoff: "constant" },
  timeout: "5 minutes",
} as const;

type ReconcileRunner = (missingIsPending: boolean) => Promise<ReconcileOutcome>;

/**
 * Reconcile with missing vectors treated as ingestion lag (retried). If the
 * retries run out, or anything else throws, a final step records the audit with
 * missing vectors counted as a real gap. If even that throws, the outcome is a
 * synthetic failure, so the draft always ends with a recorded RECONCILIATION_FAILED
 * check and never stays in reconciling.
 */
export async function reconcileWithFinalRecord(
  step: Pick<WorkflowStep, "do">,
  run: ReconcileRunner,
): Promise<ReconcileOutcome> {
  try {
    return await step.do("reconcile", RECONCILE_CONFIG, async () => run(true));
  } catch {
    // Fall through to the recorded final attempt.
  }
  try {
    return await step.do("reconcile-final", STEP_CONFIG, async () => run(false));
  } catch {
    return { mode: "ledger_getbyids", reconciled: false, status: "partial", missing: 0, expected: 0 };
  }
}
const WAIT_BASE_ITERATIONS = 60;
/** A paused draft waits at most this many UTC days for budget before it stays paused for an operator. */
const MAX_BUDGET_WINDOWS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

type Failure = { failure: UploadErrorCode };
type FileJob = {
  kind: "file";
  fileId: string;
  generationId: string;
  documentId: string;
  fileName: string;
  r2Key: string | null;
  baseGenerationId: string | null;
  title: string;
};
type DraftJob = { kind: "draft"; generationId: string; draftKind: "upload" | "reindex"; baseGenerationId: string | null };
/** Expires the files of one batch that never arrived, then lets the draft finish. */
type SweepJob = { kind: "sweep"; batchId: string; generationId: string; createdAt: number };
type Job = FileJob | DraftJob | SweepJob | { kind: "unknown" } | { kind: "closed" };

export class IngestionWorkflow extends WorkflowEntrypoint<Env, IngestionWorkflowParams> {
  private db(): SqlExecutor {
    return this.env.CORPUS_DB as unknown as SqlExecutor;
  }

  private context(): IndexContext {
    return {
      db: this.db(),
      ai: (this.env.AI as unknown as IndexContext["ai"]) ?? null,
      vectors: (this.env.VECTORIZE as unknown as VectorPort | undefined) ?? null,
    };
  }

  private async assertOpen(generationId: string): Promise<void> {
    if (!(await draftAcceptsWrites(this.db(), generationId))) {
      throw new NonRetryableError("DRAFT_CLOSED");
    }
  }

  async run(event: WorkflowEvent<IngestionWorkflowParams>, step: WorkflowStep) {
    const jobId = parseBoundedId(event.payload.jobId, "job id");
    const idempotencyKey = parseMutatingIdempotencyKey(event.payload.idempotencyKey);
    const accepted = await step.do("accept-ingestion-job", async () =>
      acknowledgeIngestJob({ jobId, idempotencyKey }),
    );
    const job = await step.do("load-job", STEP_CONFIG, async (): Promise<Job> => this.loadJob(jobId));
    if (job.kind === "file") {
      await this.runFileJob(step, job, event.instanceId);
    } else if (job.kind === "draft") {
      await this.runDraftJob(step, job, event.instanceId);
    } else if (job.kind === "sweep") {
      await this.runSweepJob(step, job, event.instanceId);
    }
    return { ...accepted, outcome: job.kind };
  }

  private async loadJob(jobId: string): Promise<Job> {
    const db = this.db();
    const file = await getUploadFile(db, jobId);
    if (file) {
      const batch = await getUploadBatch(db, file.batch_id);
      const draft = batch ? await getDraft(db, batch.generation_id) : null;
      if (!batch || !draft || draft.closedAt !== null) {
        return { kind: "closed" };
      }
      return {
        kind: "file",
        fileId: file.id,
        generationId: batch.generation_id,
        documentId: file.document_id,
        fileName: file.file_name,
        r2Key: file.r2_key,
        baseGenerationId: draft.baseGenerationId,
        title: file.file_name,
      };
    }
    const batch = await getUploadBatch(db, jobId);
    if (batch) {
      const owner = await getDraft(db, batch.generation_id);
      if (!owner || owner.closedAt !== null) {
        return { kind: "closed" };
      }
      return { kind: "sweep", batchId: batch.id, generationId: batch.generation_id, createdAt: batch.created_at };
    }
    const draft = await getDraft(db, jobId);
    if (draft && draft.closedAt === null) {
      return {
        kind: "draft",
        generationId: draft.generationId,
        draftKind: draft.kind,
        baseGenerationId: draft.baseGenerationId,
      };
    }
    return draft ? { kind: "closed" } : { kind: "unknown" };
  }

  // ---- one uploaded file -------------------------------------------------

  private async runFileJob(step: WorkflowStep, job: FileJob, owner: string): Promise<void> {
    const failFile = async (code: UploadErrorCode) => {
      // Content the file already put into the draft must go before the file
      // is reported failed, or the draft could promote what the UI called failed.
      await this.dropFailedProjection(step, job);
      await step.do("mark-file-failed", STEP_CONFIG, async () => {
        await failUploadFile(this.db(), job.fileId, code);
        return { failed: code };
      });
    };
    try {
      const already = await step.do("check-file", STEP_CONFIG, async () => {
        const row = await getUploadFile(this.db(), job.fileId);
        return { terminal: row?.stage === "ready" || row?.stage === "failed" };
      });
      if (already.terminal) {
        return;
      }
      await this.waitForBase(step, job.generationId);
      const indexed = await step.do("index-document", STEP_CONFIG, async () =>
        this.indexUpload(job),
      );
      if ("failure" in indexed) {
        await failFile(indexed.failure);
      } else {
        const ranges = Math.ceil(indexed.chunkCount / EMBED_RANGE);
        for (let range = 0; range < ranges; range += 1) {
          await step.do(`embed-${range}`, STEP_CONFIG, async () => {
            await this.assertOpen(job.generationId);
            const from = range * EMBED_RANGE;
            const to = Math.min(indexed.chunkCount, from + EMBED_RANGE);
            await embedChunkRange(this.context(), {
              generationId: job.generationId,
              documentId: job.documentId,
              from,
              to,
              reuseFromGenerationId: job.baseGenerationId,
            });
            await setChunksEmbedded(this.db(), job.fileId, to);
            return { to };
          });
        }
        await step.do("finish-file", STEP_CONFIG, async () => {
          await markFileReady(this.db(), job.fileId);
          return { ready: true };
        });
      }
    } catch (error) {
      await failFile(this.failureCode(error));
    }
    await this.finalizeDraft(step, job.generationId, owner);
  }

  /**
   * Removes a failing file's content from the draft once indexing began, and
   * puts the previous version of a document it was replacing back. If that
   * cannot be done the whole draft fails: a draft is never left holding content
   * of a file that failed. A file that is already ready, or never got as far as
   * writing, is left alone.
   */
  private async dropFailedProjection(step: WorkflowStep, job: FileJob): Promise<void> {
    try {
      const removed = await step.do("remove-file-projection", STEP_CONFIG, async () => {
        const row = await getUploadFile(this.db(), job.fileId);
        if (row?.stage !== "chunking" && row?.stage !== "embedding") {
          return { removed: false, restore: false };
        }
        // A closed draft is being (or was) cleared by whoever closed it; writing here would only leave strays.
        if (!(await draftAcceptsWrites(this.db(), job.generationId))) {
          return { removed: false, restore: false };
        }
        await removeDocumentFromDraft(this.context(), { generationId: job.generationId, documentId: job.documentId });
        if (!job.baseGenerationId) {
          return { removed: true, restore: false };
        }
        const base = await this.db()
          .prepare(`SELECT 1 AS found FROM document_catalog WHERE generation_id = ? AND document_id = ?`)
          .bind(job.baseGenerationId, job.documentId)
          .first<{ found: number }>();
        if (!base) {
          return { removed: true, restore: false };
        }
        await copyBaseDocuments(this.db(), {
          draftGenerationId: job.generationId,
          baseGenerationId: job.baseGenerationId,
          documentId: job.documentId,
        });
        return { removed: true, restore: true };
      });
      if (removed.restore && job.baseGenerationId) {
        let after = 0;
        for (let page = 0; ; page += 1) {
          const result = await step.do(`restore-base-${page}`, STEP_CONFIG, async () => {
            await this.assertOpen(job.generationId);
            return copyBaseChunkPage(this.context(), {
              draftGenerationId: job.generationId,
              baseGenerationId: job.baseGenerationId!,
              afterId: after,
              documentId: job.documentId,
            });
          });
          if (result.nextAfterId === null) {
            break;
          }
          after = result.nextAfterId;
        }
      }
    } catch {
      await step.do("fail-draft-on-cleanup", STEP_CONFIG, async () => {
        await failDraft(this.db(), job.generationId, "INDEX_UNAVAILABLE");
        return { failed: true };
      });
    }
  }

  private failureCode(error: unknown): UploadErrorCode {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DRAFT_CLOSED")) {
      return "DRAFT_CLOSED";
    }
    if (error instanceof UploadFailure) {
      return error.code;
    }
    return isUploadErrorCode(message) ? message : "INDEX_UNAVAILABLE";
  }

  private async waitForBase(step: WorkflowStep, generationId: string): Promise<void> {
    for (let attempt = 0; attempt < WAIT_BASE_ITERATIONS; attempt += 1) {
      const state = await step.do(`check-base-${attempt}`, STEP_CONFIG, async () => {
        const draft = await getDraft(this.db(), generationId);
        return { ready: draft?.baseCopiedAt != null, closed: !draft || draft.closedAt !== null };
      });
      if (state.closed) {
        throw new NonRetryableError("DRAFT_CLOSED");
      }
      if (state.ready) {
        return;
      }
      await step.sleep(`wait-base-${attempt}`, "30 seconds");
    }
    throw new UploadFailure("TIMED_OUT");
  }

  /** Parse, chunk and write one upload into the draft. A bad file returns a failure, never throws. */
  private async indexUpload(job: FileJob): Promise<{ chunkCount: number } | Failure> {
    await this.assertOpen(job.generationId);
    const db = this.db();
    const file = await getUploadFile(db, job.fileId);
    const batch = file ? await getUploadBatch(db, file.batch_id) : null;
    if (!file || !batch) {
      return { failure: "INTERNAL" };
    }
    try {
      if (!file.r2_key) {
        throw new UploadFailure("INTERNAL");
      }
      const object = await this.env.SOURCES.get(file.r2_key);
      if (!object) {
        throw new UploadFailure("INTERNAL");
      }
      if (object.size > MAX_UPLOAD_BYTES) {
        throw new UploadFailure("FILE_TOO_LARGE");
      }
      const extracted = await extractUploadText(file.file_name, new Uint8Array(await object.arrayBuffer()));
      await advanceStage(db, job.fileId, "chunking");
      const acl = batchAcl(batch);
      const doc: DocumentToIndex = {
        documentId: job.documentId,
        title: extracted.title,
        sourcePath: uploadSourcePath(file.file_name),
        sourceName: file.file_name,
        accessScope: acl.accessScope,
        allowedRoles: acl.allowedRoles,
        allowedDepartments: acl.allowedDepartments,
        metadata: {},
        r2Key: file.r2_key,
      };
      const context = this.context();
      const written = await writeDocumentChunks(context, {
        generationId: job.generationId,
        doc,
        body: extracted.text,
        ensureDocumentRow: true,
      });
      await finalizeDocument(context, {
        generationId: job.generationId,
        doc,
        body: extracted.text,
        department: null,
      });
      await setChunksTotal(db, job.fileId, written.chunkCount);
      await advanceStage(db, job.fileId, "embedding");
      return { chunkCount: written.chunkCount };
    } catch (error) {
      if (error instanceof UploadFailure) {
        return { failure: error.code };
      }
      throw error;
    }
  }

  // ---- the draft itself --------------------------------------------------

  private async runDraftJob(step: WorkflowStep, job: DraftJob, owner: string): Promise<void> {
    await step.do("start-indexing", STEP_CONFIG, async () => {
      await startIndexing(this.db(), job.generationId);
      return { started: true };
    });
    try {
      if (job.draftKind === "upload") {
        await this.copyBase(step, job);
      } else {
        await this.reindexAll(step, job);
      }
    } catch (error) {
      await step.do("fail-draft", STEP_CONFIG, async () => {
        await failDraft(this.db(), job.generationId, this.failureCode(error));
        return { failed: true };
      });
      return;
    }
    await step.do("mark-base-copied", STEP_CONFIG, async () => {
      await markBaseCopied(this.db(), job.generationId);
      return { copied: true };
    });
    await this.finalizeDraft(step, job.generationId, owner);
  }

  // ---- files that never arrived ------------------------------------------

  /**
   * Waits out the delivery window of one batch, fails the files whose bytes
   * never came, and lets the draft finish if nothing else holds it. Without
   * this a half-uploaded batch would keep the draft building for ever.
   */
  private async runSweepJob(step: WorkflowStep, job: SweepJob, owner: string): Promise<void> {
    const wait = await step.do("sweep-deadline", STEP_CONFIG, async () => ({
      ms: Math.max(0, job.createdAt + UPLOAD_DELIVERY_TTL_MS - Date.now()),
    }));
    if (wait.ms > 0) {
      await step.sleep("wait-for-uploads", wait.ms);
    }
    const open = await step.do("expire-undelivered", STEP_CONFIG, async () => {
      if (!(await draftAcceptsWrites(this.db(), job.generationId))) {
        return { open: false };
      }
      await expireUndeliveredFiles(this.db(), job.batchId);
      return { open: true };
    });
    if (open.open) {
      await this.finalizeDraft(step, job.generationId, owner);
    }
  }

  private async copyBase(step: WorkflowStep, job: DraftJob): Promise<void> {
    const base = job.baseGenerationId;
    if (!base) {
      return;
    }
    await step.do("copy-base-documents", STEP_CONFIG, async () => {
      await this.assertOpen(job.generationId);
      await copyBaseDocuments(this.db(), { draftGenerationId: job.generationId, baseGenerationId: base });
      return { copied: true };
    });
    let after = 0;
    for (let page = 0; ; page += 1) {
      const result = await step.do(`copy-chunks-${page}`, STEP_CONFIG, async () => {
        await this.assertOpen(job.generationId);
        return copyBaseChunkPage(this.context(), {
          draftGenerationId: job.generationId,
          baseGenerationId: base,
          afterId: after,
        });
      });
      if (result.nextAfterId === null) {
        return;
      }
      after = result.nextAfterId;
    }
  }

  /** Re-chunks and re-embeds every base document into the draft. No embedding is reused. */
  private async reindexAll(step: WorkflowStep, job: DraftJob): Promise<void> {
    const base = job.baseGenerationId;
    if (!base) {
      throw new UploadFailure("INTERNAL");
    }
    const ids = await step.do("list-base-documents", STEP_CONFIG, async () => {
      const rows = await this.db()
        .prepare(`SELECT document_id FROM document_catalog WHERE generation_id = ? ORDER BY document_id`)
        .bind(base)
        .all<{ document_id: string }>();
      return rows.results.map((row) => row.document_id);
    });
    for (const [index, documentId] of ids.entries()) {
      await step.do(`reindex-${index}`, STEP_CONFIG, async () => {
        await this.assertOpen(job.generationId);
        return this.reindexDocument(job.generationId, base, documentId);
      });
    }
  }

  private async reindexDocument(generationId: string, base: string, documentId: string): Promise<{ chunks: number }> {
    const db = this.db();
    const row = await db
      .prepare(
        `SELECT k.title, k.department, k.access_scope, k.allowed_roles, k.allowed_departments,
                k.metadata, k.file_name, b.body, d.path
         FROM document_catalog k
         JOIN document_bodies b ON b.document_id = k.document_id AND b.generation_id = k.generation_id
         JOIN documents d ON d.id = k.document_id
         WHERE k.generation_id = ? AND k.document_id = ?`,
      )
      .bind(base, documentId)
      .first<{
        title: string;
        department: string | null;
        access_scope: "public" | "role" | "department" | "private";
        allowed_roles: string;
        allowed_departments: string;
        metadata: string;
        file_name: string;
        body: string;
        path: string;
      }>();
    if (!row) {
      throw new UploadFailure("INTERNAL");
    }
    const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    const doc: DocumentToIndex = {
      documentId,
      title: row.title,
      sourcePath: row.path,
      sourceName: typeof metadata.source_name === "string" ? metadata.source_name : row.file_name,
      accessScope: row.access_scope,
      allowedRoles: JSON.parse(row.allowed_roles) as string[],
      allowedDepartments: JSON.parse(row.allowed_departments) as string[],
      metadata,
      r2Key: `corpus/${generationId}/${documentId}.md`,
    };
    const context = this.context();
    const written = await writeDocumentChunks(context, {
      generationId,
      doc,
      body: row.body,
      ensureDocumentRow: false,
    });
    for (let from = 0; from < written.chunkCount; from += EMBED_RANGE) {
      await embedChunkRange(context, {
        generationId,
        documentId,
        from,
        to: Math.min(written.chunkCount, from + EMBED_RANGE),
        reuseFromGenerationId: null,
      });
    }
    await finalizeDocument(context, { generationId, doc, body: row.body, department: row.department });
    return { chunks: written.chunkCount };
  }

  // ---- reconcile and checks ----------------------------------------------

  /**
   * Runs exactly once per draft: the instance that wins the claim does the
   * reconcile and the checks. The claim belongs to this workflow instance, so a
   * retried claim step resumes it instead of abandoning the draft.
   */
  private async finalizeDraft(step: WorkflowStep, generationId: string, owner: string): Promise<void> {
    const claimed = await step.do("claim-finalize", STEP_CONFIG, async () => ({
      claimed: await claimFinalize(this.db(), generationId, owner),
    }));
    if (!claimed.claimed) {
      return;
    }
    if (!(await this.reserveWithinBudget(step, generationId))) {
      return;
    }
    const context = this.context();
    // A MutationPendingError is thrown on purpose: the step retries until the
    // index reports it processed the newest mutation.
    const reconciled = await reconcileWithFinalRecord(step, (missingIsPending) =>
      reconcileDraft({ db: context.db, vectors: context.vectors, generationId, missingIsPending }),
    );
    const probe = await step.do("acl-parity", STEP_CONFIG, async () => {
      const documents = await this.uploadedAclDocuments(generationId);
      return aclParityProbe(this.db(), generationId, documents);
    });
    const retrievalAvailable = Boolean(context.ai) && reconciled.reconciled;
    const batches: RetrievalBatchResult[] = [];
    let retrievalFailed = false;
    if (retrievalAvailable) {
      for (let from = 0; from < fixture.questions.length && !retrievalFailed; from += RETRIEVAL_BATCH) {
        try {
          batches.push(
            await step.do(`retrieval-${from / RETRIEVAL_BATCH}`, STEP_CONFIG, async () =>
              runRetrievalBatch({
                db: context.db,
                ai: context.ai!,
                vectorize: (this.env.VECTORIZE as unknown as VectorizeIndex | undefined) ?? null,
                generationId,
                fixture,
                from,
                to: Math.min(fixture.questions.length, from + RETRIEVAL_BATCH),
              }),
            ),
          );
        } catch {
          retrievalFailed = true;
        }
      }
    }
    await step.do("finish-checks", STEP_CONFIG, async () => {
      const draft = await getDraft(this.db(), generationId);
      const summary = aggregateRecall(batches);
      const added = await this.db()
        .prepare(
          `SELECT COUNT(*) AS n FROM upload_files f JOIN upload_batches b ON b.id = f.batch_id
           WHERE b.generation_id = ? AND f.stage = 'ready'`,
        )
        .bind(generationId)
        .first<{ n: number }>();
      const decision = decideChecks({
        reconciled: reconciled.reconciled,
        aclLeaks: probe.leaks + summary.leaks,
        parityErrors: probe.parityErrors,
        liveRecall: summary.liveRecall,
        retrievalAvailable: retrievalAvailable && !retrievalFailed,
        documentsAdded: draft?.kind === "upload" ? (added?.n ?? 0) : null,
      });
      const { errorCode, status } = decision;
      await finishCheckRun(this.db(), generationId, {
        status,
        reconciled: reconciled.reconciled,
        mode: reconciled.mode,
        aclLeaks: probe.leaks + summary.leaks,
        liveRecall: summary.liveRecall,
        questionsRun: summary.questionsRun,
        errorCode,
      });
      if (status === "passed") {
        await markDraftReady(this.db(), generationId);
      }
      return { status };
    });
  }

  /**
   * Reserves a check run. When the daily budget is spent the owner keeps
   * waiting: it sleeps to the start of the next UTC day and tries again in a new
   * durable step, so a paused draft resumes by itself. Gives up (draft stays
   * paused for an operator) after MAX_BUDGET_WINDOWS days, or as soon as the
   * draft is no longer open.
   */
  private async reserveWithinBudget(step: WorkflowStep, generationId: string): Promise<boolean> {
    const first = await step.do("reserve-checks", STEP_CONFIG, async () => ({
      outcome: await reserveCheckRun(this.db(), generationId),
    }));
    let outcome: "started" | "paused" | "existing" | "closed" = first.outcome;
    for (let window = 0; outcome === "paused"; window += 1) {
      if (window >= MAX_BUDGET_WINDOWS) {
        return false;
      }
      const next = await step.do(`budget-window-${window}`, STEP_CONFIG, async () => {
        const now = Date.now();
        const at = (Math.floor(now / DAY_MS) + 1) * DAY_MS;
        return { at, ms: at - now };
      });
      await step.sleep(`wait-for-budget-${window}`, next.ms);
      const retry = await step.do(`reserve-checks-${window + 1}`, STEP_CONFIG, async () => {
        if (!(await draftAcceptsWrites(this.db(), generationId))) {
          return { outcome: "closed" as const };
        }
        // The window opened at `next.at`; count the day from there even if the wake-up was early.
        return { outcome: await reserveCheckRun(this.db(), generationId, Math.max(Date.now(), next.at)) };
      });
      outcome = retry.outcome;
    }
    return outcome !== "closed";
  }

  private async uploadedAclDocuments(generationId: string): Promise<AclProbeDocument[]> {
    const rows = await this.db()
      .prepare(
        `SELECT DISTINCT f.document_id, b.access_scope, b.allowed_roles, b.allowed_departments
         FROM upload_files f JOIN upload_batches b ON b.id = f.batch_id
         WHERE b.generation_id = ? AND f.stage = 'ready'`,
      )
      .bind(generationId)
      .all<{
        document_id: string;
        access_scope: "public" | "department" | "role";
        allowed_roles: string;
        allowed_departments: string;
      }>();
    return rows.results.map((row) => ({
      documentId: row.document_id,
      accessScope: row.access_scope,
      allowedRoles: JSON.parse(row.allowed_roles) as string[],
      allowedDepartments: JSON.parse(row.allowed_departments) as string[],
    }));
  }
}
