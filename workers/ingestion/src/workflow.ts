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
  failUploadFile,
  getUploadBatch,
  getUploadFile,
  markFileReady,
  setChunksEmbedded,
  setChunksTotal,
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
const WAIT_BASE_ITERATIONS = 60;

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
type Job = FileJob | DraftJob | { kind: "unknown" } | { kind: "closed" };

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
      await this.runFileJob(step, job);
    } else if (job.kind === "draft") {
      await this.runDraftJob(step, job);
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

  private async runFileJob(step: WorkflowStep, job: FileJob): Promise<void> {
    const failFile = async (code: UploadErrorCode) => {
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
    await this.finalizeDraft(step, job.generationId);
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

  private async runDraftJob(step: WorkflowStep, job: DraftJob): Promise<void> {
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
    await this.finalizeDraft(step, job.generationId);
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

  /** Runs exactly once per draft: the caller that wins the claim does the reconcile and the checks. */
  private async finalizeDraft(step: WorkflowStep, generationId: string): Promise<void> {
    const claimed = await step.do("claim-finalize", STEP_CONFIG, async () => ({
      claimed: await claimFinalize(this.db(), generationId),
    }));
    if (!claimed.claimed) {
      return;
    }
    const reserved = await step.do("reserve-checks", STEP_CONFIG, async () => ({
      outcome: await reserveCheckRun(this.db(), generationId),
    }));
    if (reserved.outcome === "paused") {
      return;
    }
    const context = this.context();
    // A MutationPendingError is thrown on purpose: the step retries until the
    // index reports it processed the newest mutation.
    const reconciled = await step.do("reconcile", RECONCILE_CONFIG, async () =>
      reconcileDraft({ db: context.db, vectors: context.vectors, generationId }),
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
