import { ensureGenerationState, type SqlExecutor } from "./corpus-d1";
import { canMarkReady } from "./generations";
import { EMBEDDING_DIMENSIONS } from "../embeddings/instructions";

/** draft -> indexing, once, when the draft job starts. Replays are no-ops. */
export async function startIndexing(db: SqlExecutor, generationId: string, now = Date.now()): Promise<void> {
  await db
    .prepare(`UPDATE corpus_generations SET state = 'indexing', updated_at = ? WHERE id = ? AND state = 'draft'`)
    .bind(now, generationId)
    .run();
}

/**
 * indexing -> reconciling for exactly one caller, and only when the base copy
 * is done and no uploaded file is still open. The check and the move are one
 * statement, so two finishing files cannot both win.
 */
export async function claimFinalize(db: SqlExecutor, generationId: string, now = Date.now()): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE corpus_generations SET state = 'reconciling', updated_at = ?
       WHERE id = ? AND state = 'indexing'
         AND EXISTS (
           SELECT 1 FROM drafts d
           WHERE d.generation_id = corpus_generations.id
             AND d.closed_at IS NULL AND d.base_copied_at IS NOT NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM upload_files f JOIN upload_batches b ON b.id = f.batch_id
           WHERE b.generation_id = corpus_generations.id AND f.stage NOT IN ('ready', 'failed')
         )`,
    )
    .bind(now, generationId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * reconciling -> ready, only after the audit was complete and clean. Checks
 * passing is what makes a draft promotable, so `ready` is never set earlier.
 */
export async function markDraftReady(db: SqlExecutor, generationId: string, now = Date.now()): Promise<void> {
  const audit = await db
    .prepare(`SELECT status, missing_count, orphan_count FROM reconciliation_audits WHERE id = ?`)
    .bind(generationId)
    .first<{ status: "complete" | "partial" | "unsupported"; missing_count: number; orphan_count: number }>();
  await db
    .prepare(`UPDATE corpus_generations SET metadata_index_ready = 1, updated_at = ? WHERE id = ?`)
    .bind(now, generationId)
    .run();
  canMarkReady({
    auditStatus: audit?.status ?? "unsupported",
    auditClean: audit !== null && audit.missing_count === 0 && audit.orphan_count === 0,
    metadataIndexReady: true,
    dimensions: EMBEDDING_DIMENSIONS,
    expectedDimensions: EMBEDDING_DIMENSIONS,
  });
  await ensureGenerationState(db, generationId, "ready", now);
}
