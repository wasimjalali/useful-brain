import { WorkerValidationError } from "../cf/worker-errors";
import { activeGenerationId, ensureDraftGeneration, type SqlExecutor } from "./corpus-d1";
import { newBoundedId } from "./conversations";
import type { GenerationState } from "./generations";

export type DraftKind = "upload" | "reindex";

export type OpenDraft = {
  generationId: string;
  kind: DraftKind;
  baseGenerationId: string | null;
  createdBy: string;
  baseCopiedAt: number | null;
  state: GenerationState;
};

type DraftRow = {
  generation_id: string;
  kind: DraftKind;
  base_generation_id: string | null;
  created_by: string;
  base_copied_at: number | null;
  state: GenerationState;
};

const DRAFT_SELECT = `SELECT d.generation_id, d.kind, d.base_generation_id, d.created_by,
  d.base_copied_at, g.state
  FROM drafts d JOIN corpus_generations g ON g.id = d.generation_id`;

function toDraft(row: DraftRow): OpenDraft {
  return {
    generationId: row.generation_id,
    kind: row.kind,
    baseGenerationId: row.base_generation_id,
    createdBy: row.created_by,
    baseCopiedAt: row.base_copied_at,
    state: row.state,
  };
}

export async function getOpenDraft(db: SqlExecutor): Promise<OpenDraft | null> {
  const row = await db
    .prepare(`${DRAFT_SELECT} WHERE d.closed_at IS NULL`)
    .first<DraftRow>();
  return row ? toDraft(row) : null;
}

export async function getDraft(db: SqlExecutor, generationId: string): Promise<(OpenDraft & { closedAt: number | null }) | null> {
  const row = await db
    .prepare(`${DRAFT_SELECT} WHERE d.generation_id = ?`)
    .bind(generationId)
    .first<DraftRow>();
  if (!row) {
    return null;
  }
  const closed = await db
    .prepare(`SELECT closed_at FROM drafts WHERE generation_id = ?`)
    .bind(generationId)
    .first<{ closed_at: number | null }>();
  return { ...toDraft(row), closedAt: closed?.closed_at ?? null };
}

/**
 * Returns the one open draft, creating it (copy-on-write from the active
 * generation) when none exists. The unique partial index serializes a race:
 * the loser deletes its empty generation and reuses the winner's draft.
 */
export async function ensureOpenDraft(
  db: SqlExecutor,
  input: { kind: DraftKind; createdBy: string; now?: number },
): Promise<{ draft: OpenDraft; created: boolean }> {
  const existing = await getOpenDraft(db);
  if (existing) {
    return { draft: existing, created: false };
  }
  const now = input.now ?? Date.now();
  const generationId = newBoundedId("g");
  const baseGenerationId = await activeGenerationId(db);
  await ensureDraftGeneration(db, generationId, now);
  try {
    await db
      .prepare(
        `INSERT INTO drafts (generation_id, kind, base_generation_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(generationId, input.kind, baseGenerationId, input.createdBy, now)
      .run();
  } catch (error) {
    await db.prepare(`DELETE FROM corpus_generations WHERE id = ?`).bind(generationId).run();
    const winner = await getOpenDraft(db);
    if (winner) {
      return { draft: winner, created: false };
    }
    throw error;
  }
  const created = await getOpenDraft(db);
  if (!created) {
    throw new Error("draft was not recorded");
  }
  return { draft: created, created: true };
}

/** An upload may join a draft only while it is still being built. */
export function assertAcceptsUploads(draft: OpenDraft): void {
  if (draft.kind !== "upload" || (draft.state !== "draft" && draft.state !== "indexing")) {
    throw new WorkerValidationError("Promote or discard the current draft first.");
  }
}

export async function markBaseCopied(db: SqlExecutor, generationId: string, now = Date.now()): Promise<void> {
  await db
    .prepare(`UPDATE drafts SET base_copied_at = ? WHERE generation_id = ? AND base_copied_at IS NULL`)
    .bind(now, generationId)
    .run();
}

export async function closeDraft(db: SqlExecutor, generationId: string, now = Date.now()): Promise<void> {
  await db
    .prepare(`UPDATE drafts SET closed_at = ? WHERE generation_id = ? AND closed_at IS NULL`)
    .bind(now, generationId)
    .run();
}

/**
 * Marks a draft failed and closes it. Only generations that are not yet live
 * change state, so this can never touch the active pointer or the active row.
 */
export async function failDraft(
  db: SqlExecutor,
  generationId: string,
  errorCode: string,
  now = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE corpus_generations SET state = 'failed', error_code = ?, updated_at = ?
       WHERE id = ? AND state IN ('draft', 'indexing', 'reconciling', 'ready')`,
    )
    .bind(errorCode, now, generationId)
    .run();
  await closeDraft(db, generationId, now);
}

/** True while the workflow may still write into this generation. */
export async function draftAcceptsWrites(db: SqlExecutor, generationId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT g.state FROM drafts d JOIN corpus_generations g ON g.id = d.generation_id
       WHERE d.generation_id = ? AND d.closed_at IS NULL`,
    )
    .bind(generationId)
    .first<{ state: string }>();
  return row !== null && ["draft", "indexing", "reconciling"].includes(row.state);
}
