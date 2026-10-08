import type { UploadAcl } from "../ingest/upload-validation";
import { uploadDocumentId } from "../ingest/upload-validation";
import { uploadErrorMessage } from "../ingest/error-codes";
import type { UploadCreated, UploadErrorCode, UploadStage, UploadStatus } from "../contracts/sources";
import { WorkerNotFoundError, WorkerValidationError } from "../cf/worker-errors";
import type { SqlExecutor } from "./corpus-d1";
import { newBoundedId } from "./conversations";

const STAGE_RANK: Record<UploadStage, number> = {
  parsing: 0,
  chunking: 1,
  embedding: 2,
  ready: 3,
  failed: 3,
};

export type UploadFileRow = {
  id: string;
  batch_id: string;
  file_name: string;
  byte_size: number;
  document_id: string;
  r2_key: string | null;
  stage: UploadStage;
  error_code: string | null;
  chunks_total: number | null;
  chunks_embedded: number;
};

export type UploadBatchRow = {
  id: string;
  generation_id: string;
  created_by: string;
  access_scope: "public" | "department" | "role";
  allowed_roles: string;
  allowed_departments: string;
  created_at: number;
};

/** A declared file must arrive within this long of its batch being created. */
export const UPLOAD_DELIVERY_TTL_MS = 30 * 60 * 1000;

export function batchAcl(batch: Pick<UploadBatchRow, "access_scope" | "allowed_roles" | "allowed_departments">): UploadAcl {
  return {
    accessScope: batch.access_scope,
    allowedRoles: JSON.parse(batch.allowed_roles) as string[],
    allowedDepartments: JSON.parse(batch.allowed_departments) as string[],
  };
}

type CreateBatchInput = {
  generationId: string;
  createdBy: string;
  acl: UploadAcl;
  idempotencyKey: string;
  files: { name: string; size: number }[];
  now?: number;
};

/**
 * The batch an idempotency key already created, or null for a new key. A key
 * is bound to the whole normalized request: creator, readers and the exact set
 * of files with their sizes. Replaying it with anything different is rejected,
 * so a retry can never hand back a batch with other readers than were asked for.
 * File order does not matter; the answer follows the order of the request.
 */
export async function resolveUploadReplay(
  db: SqlExecutor,
  input: Pick<CreateBatchInput, "createdBy" | "acl" | "idempotencyKey" | "files">,
): Promise<(UploadCreated & { generationId: string }) | null> {
  const existing = await db
    .prepare(
      `SELECT id, generation_id, created_by, access_scope, allowed_roles, allowed_departments
       FROM upload_batches WHERE idempotency_key = ?`,
    )
    .bind(input.idempotencyKey)
    .first<Pick<UploadBatchRow, "id" | "generation_id" | "created_by" | "access_scope" | "allowed_roles" | "allowed_departments">>();
  if (!existing) {
    return null;
  }
  const rows = await db
    .prepare(`SELECT id, file_name, byte_size FROM upload_files WHERE batch_id = ?`)
    .bind(existing.id)
    .all<{ id: string; file_name: string; byte_size: number }>();
  const stored = new Map(rows.results.map((row) => [row.file_name, row]));
  const same =
    existing.created_by === input.createdBy &&
    existing.access_scope === input.acl.accessScope &&
    existing.allowed_roles === JSON.stringify(input.acl.allowedRoles) &&
    existing.allowed_departments === JSON.stringify(input.acl.allowedDepartments) &&
    stored.size === input.files.length &&
    input.files.every((file) => stored.get(file.name)?.byte_size === file.size);
  if (!same) {
    throw new WorkerValidationError();
  }
  return {
    batchId: existing.id,
    generationId: existing.generation_id,
    files: input.files.map((file) => ({ id: stored.get(file.name)!.id, name: file.name })),
  };
}

/**
 * Creates a batch and its file rows in one atomic batch. The same
 * idempotency key with the same request returns the original ids; with a
 * different request it is rejected.
 */
export async function createUploadBatch(db: SqlExecutor, input: CreateBatchInput): Promise<UploadCreated> {
  const now = input.now ?? Date.now();
  const replay = await resolveUploadReplay(db, input);
  if (replay) {
    return { batchId: replay.batchId, files: replay.files };
  }
  const batchId = newBoundedId("ub");
  const files: UploadCreated["files"] = [];
  const statements = [
    db
      .prepare(
        // Conditional on the draft still being built, so a batch can never land
        // in a draft that already started its checks.
        `INSERT INTO upload_batches (
           id, generation_id, created_by, access_scope, allowed_roles, allowed_departments,
           idempotency_key, created_at
         ) SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM corpus_generations WHERE id = ? AND state IN ('draft', 'indexing')
         )`,
      )
      .bind(
        batchId,
        input.generationId,
        input.createdBy,
        input.acl.accessScope,
        JSON.stringify(input.acl.allowedRoles),
        JSON.stringify(input.acl.allowedDepartments),
        input.idempotencyKey,
        now,
        input.generationId,
      ),
  ];
  for (const file of input.files) {
    const fileId = newBoundedId("uf");
    files.push({ id: fileId, name: file.name });
    statements.push(
      db
        .prepare(
          `INSERT INTO upload_files (
             id, batch_id, file_name, byte_size, document_id, stage, created_at, updated_at
           ) SELECT ?, ?, ?, ?, ?, 'parsing', ?, ?
           WHERE EXISTS (SELECT 1 FROM upload_batches WHERE id = ?)`,
        )
        .bind(fileId, batchId, file.name, file.size, await uploadDocumentId(file.name), now, now, batchId),
    );
  }
  let results: Awaited<ReturnType<SqlExecutor["batch"]>>;
  try {
    results = await db.batch(statements);
  } catch (error) {
    // Two requests with one key raced and this one hit the unique key: answer
    // it as the replay it is. Anything else is a real failure.
    const winner = await resolveUploadReplay(db, input);
    if (winner) {
      return { batchId: winner.batchId, files: winner.files };
    }
    throw error;
  }
  if ((results[0]?.meta?.changes ?? 0) !== 1) {
    throw new WorkerValidationError("Promote or discard the current draft first.");
  }
  return { batchId, files };
}

export async function getUploadFile(db: SqlExecutor, fileId: string): Promise<UploadFileRow | null> {
  return db
    .prepare(
      `SELECT id, batch_id, file_name, byte_size, document_id, r2_key, stage, error_code,
              chunks_total, chunks_embedded
       FROM upload_files WHERE id = ?`,
    )
    .bind(fileId)
    .first<UploadFileRow>();
}

export async function getUploadBatch(db: SqlExecutor, batchId: string): Promise<UploadBatchRow | null> {
  return db
    .prepare(
      `SELECT id, generation_id, created_by, access_scope, allowed_roles, allowed_departments, created_at
       FROM upload_batches WHERE id = ?`,
    )
    .bind(batchId)
    .first<UploadBatchRow>();
}

/** False when the file already left the parsing stage (it expired or its draft closed): the object is then unwanted. */
export async function recordUploadedObject(
  db: SqlExecutor,
  fileId: string,
  r2Key: string,
  now = Date.now(),
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE upload_files SET r2_key = ?, updated_at = ?
       WHERE id = ? AND stage = 'parsing'`,
    )
    .bind(r2Key, now, fileId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Fails every file of the batch whose bytes never arrived, so a half-uploaded
 * batch cannot hold the draft open for ever. Files that arrived are untouched.
 */
export async function expireUndeliveredFiles(db: SqlExecutor, batchId: string, now = Date.now()): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE upload_files SET stage = 'failed', error_code = 'NOT_RECEIVED', updated_at = ?
       WHERE batch_id = ? AND stage = 'parsing' AND r2_key IS NULL`,
    )
    .bind(now, batchId)
    .run();
  return result.meta?.changes ?? 0;
}

/** Stages only move forward; failed and ready are terminal. Returns true when the row moved. */
export async function advanceStage(
  db: SqlExecutor,
  fileId: string,
  stage: Exclude<UploadStage, "failed">,
  now = Date.now(),
): Promise<boolean> {
  const rank = STAGE_RANK[stage];
  const result = await db
    .prepare(
      `UPDATE upload_files SET stage = ?, updated_at = ?
       WHERE id = ? AND stage <> 'failed' AND stage <> 'ready'
         AND CASE stage WHEN 'parsing' THEN 0 WHEN 'chunking' THEN 1 WHEN 'embedding' THEN 2 ELSE 3 END < ?`,
    )
    .bind(stage, now, fileId, rank)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function failUploadFile(
  db: SqlExecutor,
  fileId: string,
  code: UploadErrorCode,
  now = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE upload_files SET stage = 'failed', error_code = ?, updated_at = ?
       WHERE id = ? AND stage <> 'ready' AND stage <> 'failed'`,
    )
    .bind(code, now, fileId)
    .run();
}

export async function setChunksTotal(db: SqlExecutor, fileId: string, total: number, now = Date.now()): Promise<void> {
  await db
    .prepare(`UPDATE upload_files SET chunks_total = ?, chunks_embedded = 0, updated_at = ? WHERE id = ?`)
    .bind(total, now, fileId)
    .run();
}

/** Absolute and monotonic, so a replayed step cannot move the counter backwards. */
export async function setChunksEmbedded(db: SqlExecutor, fileId: string, embedded: number, now = Date.now()): Promise<void> {
  await db
    .prepare(
      `UPDATE upload_files SET chunks_embedded = MAX(chunks_embedded, ?), updated_at = ? WHERE id = ?`,
    )
    .bind(embedded, now, fileId)
    .run();
}

export async function markFileReady(db: SqlExecutor, fileId: string, now = Date.now()): Promise<void> {
  await db
    .prepare(
      `UPDATE upload_files SET stage = 'ready', chunks_embedded = COALESCE(chunks_total, chunks_embedded),
         updated_at = ?
       WHERE id = ? AND stage <> 'failed'`,
    )
    .bind(now, fileId)
    .run();
}

export async function getUploadStatus(db: SqlExecutor, batchId: string): Promise<UploadStatus> {
  const batch = await getUploadBatch(db, batchId);
  if (!batch) {
    throw new WorkerNotFoundError();
  }
  const rows = await db
    .prepare(
      `SELECT id, file_name, stage, error_code FROM upload_files WHERE batch_id = ? ORDER BY created_at, rowid`,
    )
    .bind(batchId)
    .all<{ id: string; file_name: string; stage: UploadStage; error_code: string | null }>();
  return {
    batchId,
    files: rows.results.map((row) => {
      const message = row.stage === "failed" ? uploadErrorMessage(row.error_code ?? "INTERNAL") : undefined;
      return {
        id: row.id,
        name: row.file_name,
        stage: row.stage,
        ...(message ? { errorMessage: message } : {}),
      };
    }),
  };
}

/** True when every uploaded file of the draft has finished (ready or failed). */
export async function allUploadsTerminal(db: SqlExecutor, generationId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS open FROM upload_files f JOIN upload_batches b ON b.id = f.batch_id
       WHERE b.generation_id = ? AND f.stage NOT IN ('ready', 'failed')`,
    )
    .bind(generationId)
    .first<{ open: number }>();
  return (row?.open ?? 0) === 0;
}
