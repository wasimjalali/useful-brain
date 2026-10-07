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
};

export function batchAcl(batch: Pick<UploadBatchRow, "access_scope" | "allowed_roles" | "allowed_departments">): UploadAcl {
  return {
    accessScope: batch.access_scope,
    allowedRoles: JSON.parse(batch.allowed_roles) as string[],
    allowedDepartments: JSON.parse(batch.allowed_departments) as string[],
  };
}

/**
 * Creates a batch and its file rows in one atomic batch. The same
 * idempotency key with the same files returns the original ids; with
 * different files it is rejected.
 */
export async function createUploadBatch(
  db: SqlExecutor,
  input: {
    generationId: string;
    createdBy: string;
    acl: UploadAcl;
    idempotencyKey: string;
    files: { name: string; size: number }[];
    now?: number;
  },
): Promise<UploadCreated> {
  const now = input.now ?? Date.now();
  const existing = await db
    .prepare(`SELECT id FROM upload_batches WHERE idempotency_key = ?`)
    .bind(input.idempotencyKey)
    .first<{ id: string }>();
  if (existing) {
    const rows = await db
      .prepare(
        `SELECT id, file_name, byte_size FROM upload_files WHERE batch_id = ? ORDER BY created_at, rowid`,
      )
      .bind(existing.id)
      .all<{ id: string; file_name: string; byte_size: number }>();
    const same =
      rows.results.length === input.files.length &&
      input.files.every((file) =>
        rows.results.some((row) => row.file_name === file.name && row.byte_size === file.size),
      );
    if (!same) {
      throw new WorkerValidationError();
    }
    const byName = new Map(rows.results.map((row) => [row.file_name, row.id]));
    return {
      batchId: existing.id,
      files: input.files.map((file) => ({ id: byName.get(file.name)!, name: file.name })),
    };
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
  const results = await db.batch(statements);
  if ((results[0]?.meta?.changes ?? 0) !== 1) {
    throw new WorkerValidationError("Promote or discard the current draft first.");
  }
  return { batchId, files };
}

export async function uploadBatchKeyExists(db: SqlExecutor, idempotencyKey: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS found FROM upload_batches WHERE idempotency_key = ?`)
    .bind(idempotencyKey)
    .first<{ found: number }>();
  return row !== null;
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
      `SELECT id, generation_id, created_by, access_scope, allowed_roles, allowed_departments
       FROM upload_batches WHERE id = ?`,
    )
    .bind(batchId)
    .first<UploadBatchRow>();
}

export async function recordUploadedObject(
  db: SqlExecutor,
  fileId: string,
  r2Key: string,
  now = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE upload_files SET r2_key = ?, updated_at = ?
       WHERE id = ? AND stage = 'parsing'`,
    )
    .bind(r2Key, now, fileId)
    .run();
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
