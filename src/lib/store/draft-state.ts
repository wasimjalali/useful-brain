import type { SqlExecutor } from "./corpus-d1";
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
 * indexing -> reconciling for exactly one owner (a workflow instance id), and
 * only when the base copy is done and no uploaded file is still open. The
 * owner is recorded in the same atomic batch as the move, so the claim is
 * idempotent per owner: if the step that won it is retried (the commit landed,
 * the answer was lost) the same owner gets true again and carries on, while any
 * other owner gets false. Returns false once the draft closed or moved past
 * reconciling.
 */
export async function claimFinalize(
  db: SqlExecutor,
  generationId: string,
  owner: string,
  now = Date.now(),
): Promise<boolean> {
  await db.batch([
    db
      .prepare(
        `UPDATE drafts SET finalize_owner = ?
         WHERE generation_id = ? AND finalize_owner IS NULL
           AND closed_at IS NULL AND base_copied_at IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM corpus_generations g WHERE g.id = drafts.generation_id AND g.state = 'indexing'
           )
           AND NOT EXISTS (
             SELECT 1 FROM upload_files f JOIN upload_batches b ON b.id = f.batch_id
             WHERE b.generation_id = drafts.generation_id AND f.stage NOT IN ('ready', 'failed')
           )`,
      )
      .bind(owner, generationId),
    db
      .prepare(
        `UPDATE corpus_generations SET state = 'reconciling', updated_at = ?
         WHERE id = ? AND state = 'indexing'
           AND EXISTS (
             SELECT 1 FROM drafts d
             WHERE d.generation_id = corpus_generations.id AND d.finalize_owner = ? AND d.closed_at IS NULL
           )`,
      )
      .bind(now, generationId, owner),
  ]);
  const row = await db
    .prepare(
      `SELECT d.finalize_owner, d.closed_at, g.state FROM drafts d
       JOIN corpus_generations g ON g.id = d.generation_id WHERE d.generation_id = ?`,
    )
    .bind(generationId)
    .first<{ finalize_owner: string | null; closed_at: number | null; state: string }>();
  return row !== null && row.finalize_owner === owner && row.closed_at === null && row.state === "reconciling";
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
  // Conditional on still reconciling: a discard that landed meanwhile keeps its
  // failed state instead of being overwritten with ready.
  const moved = await db
    .prepare(
      `UPDATE corpus_generations SET state = 'ready', updated_at = ? WHERE id = ? AND state = 'reconciling'`,
    )
    .bind(now, generationId)
    .run();
  if ((moved.meta?.changes ?? 0) === 0) {
    const row = await db
      .prepare(`SELECT state FROM corpus_generations WHERE id = ?`)
      .bind(generationId)
      .first<{ state: string }>();
    if (row?.state !== "ready") {
      throw new Error(`draft ${generationId} is ${row?.state ?? "missing"}, not reconciling`);
    }
  }
}
