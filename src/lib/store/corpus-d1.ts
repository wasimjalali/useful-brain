import { auditStoreConsistency, type ConsistencyReport } from "./inventory-audit";
import {
  assertTransition,
  canMarkReady,
  GenerationTransitionError,
  type GenerationState,
} from "./generations";
import { EMBEDDING_DIMENSIONS } from "../embeddings/instructions";

export type SqlRunResult = {
  meta?: { changes?: number };
};

type SqlStatement = {
  bind(...values: Array<string | number | null>): SqlStatement;
  run(): Promise<SqlRunResult>;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
};

export type SqlExecutor = {
  prepare(query: string): SqlStatement;
};

export type GenerationRow = {
  id: string;
  state: GenerationState;
};

export async function ensureDraftGeneration(
  db: SqlExecutor,
  generationId: string,
  now = Date.now(),
): Promise<{ generationId: string; state: string }> {
  await db
    .prepare(
      `INSERT INTO corpus_state (singleton, active_generation_id) VALUES (1, NULL)
       ON CONFLICT(singleton) DO NOTHING`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO corpus_generations (id, state, created_at, updated_at)
       VALUES (?, 'draft', ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
       WHERE corpus_generations.state IN ('draft', 'indexing', 'reconciling', 'failed')`,
    )
    .bind(generationId, now, now)
    .run();
  const row = await getGeneration(db, generationId);
  if (!row) {
    throw new Error("draft generation was not recorded");
  }
  return { generationId: row.id, state: row.state };
}

export async function getGeneration(
  db: SqlExecutor,
  generationId: string,
): Promise<GenerationRow | null> {
  return db
    .prepare(`SELECT id, state FROM corpus_generations WHERE id = ?`)
    .bind(generationId)
    .first<GenerationRow>();
}

export async function activeGenerationId(db: SqlExecutor): Promise<string | null> {
  const row = await db
    .prepare(`SELECT active_generation_id FROM corpus_state WHERE singleton = 1`)
    .first<{ active_generation_id: string | null }>();
  return row?.active_generation_id ?? null;
}

export async function setGenerationState(
  db: SqlExecutor,
  generationId: string,
  state: string,
  now = Date.now(),
): Promise<void> {
  await db
    .prepare(`UPDATE corpus_generations SET state = ?, updated_at = ? WHERE id = ?`)
    .bind(state, now, generationId)
    .run();
}

export async function ensureGenerationState(
  db: SqlExecutor,
  generationId: string,
  state: GenerationState,
  now = Date.now(),
): Promise<GenerationRow> {
  const row = await getGeneration(db, generationId);
  if (!row) {
    throw new GenerationTransitionError(`generation ${generationId} is missing`);
  }
  if (row.state === state) {
    return row;
  }
  assertTransition(row.state, state);
  await setGenerationState(db, generationId, state, now);
  return { id: generationId, state };
}

export async function promoteGeneration(
  db: SqlExecutor,
  generationId: string,
  now = Date.now(),
): Promise<void> {
  const row = await getGeneration(db, generationId);
  if (!row || row.state !== "ready") {
    throw new GenerationTransitionError("only a ready generation can be promoted");
  }
  const previous = await activeGenerationId(db);
  await db
    .prepare(`UPDATE corpus_state SET active_generation_id = ? WHERE singleton = 1`)
    .bind(generationId)
    .run();
  await setGenerationState(db, generationId, "active", now);
  if (previous && previous !== generationId) {
    const previousRow = await getGeneration(db, previous);
    if (previousRow?.state === "active") {
      await setGenerationState(db, previous, "archived", now);
    }
  }
}

export async function rollbackGeneration(
  db: SqlExecutor,
  previousId: string,
  now = Date.now(),
): Promise<void> {
  const previous = await getGeneration(db, previousId);
  if (!previous || (previous.state !== "ready" && previous.state !== "active" && previous.state !== "archived")) {
    throw new GenerationTransitionError("rollback requires a retained ready or active generation");
  }
  const current = await activeGenerationId(db);
  if (current === previousId) {
    throw new GenerationTransitionError("rollback target is already active");
  }
  await db
    .prepare(`UPDATE corpus_state SET active_generation_id = ? WHERE singleton = 1`)
    .bind(previousId)
    .run();
  if (current) {
    const currentRow = await getGeneration(db, current);
    if (currentRow?.state === "active") {
      await setGenerationState(db, current, "archived", now);
    }
  }
  if (previous.state !== "active") {
    await setGenerationState(db, previousId, "active", now);
  }
}

export async function loadExpectedVectorIds(
  db: SqlExecutor,
  generationId: string,
): Promise<Record<string, string>> {
  const result = await db
    .prepare(`SELECT vector_id, chunk_id FROM chunks WHERE generation_id = ?`)
    .bind(generationId)
    .all<{ vector_id: string; chunk_id: string }>();
  const map: Record<string, string> = {};
  for (const row of result.results) {
    map[row.vector_id] = row.chunk_id;
  }
  return map;
}

export async function recordAudit(
  db: SqlExecutor,
  generationId: string,
  report: ConsistencyReport,
  now = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO reconciliation_audits (
         id, generation_id, status, missing_count, orphan_count, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         missing_count = excluded.missing_count,
         orphan_count = excluded.orphan_count,
         created_at = excluded.created_at`,
    )
    .bind(
      generationId,
      generationId,
      report.status,
      report.missingVectors.length,
      report.orphanVectors.length,
      now,
    )
    .run();
}

export async function reconcileAndFinalize(
  db: SqlExecutor,
  generationId: string,
  now = Date.now(),
): Promise<{ generationId: string; state: GenerationState; auditStatus: ConsistencyReport["status"] }> {
  const current = await getGeneration(db, generationId);
  if (current?.state === "ready" || current?.state === "failed") {
    const audit = await db
      .prepare(`SELECT status FROM reconciliation_audits WHERE id = ?`)
      .bind(generationId)
      .first<{ status: ConsistencyReport["status"] }>();
    return {
      generationId,
      state: current.state,
      auditStatus: audit?.status ?? "unsupported",
    };
  }
  await ensureGenerationState(db, generationId, "indexing", now);
  await ensureGenerationState(db, generationId, "reconciling", now);
  const expected = await loadExpectedVectorIds(db, generationId);
  const report = auditStoreConsistency({
    inventoryWatermark: () => null,
    expectedVectorIds: () => expected,
    vectorIds: () => [],
  });
  await recordAudit(db, generationId, report, now);
  if (report.clean) {
    await db
      .prepare(`UPDATE corpus_generations SET metadata_index_ready = 1, updated_at = ? WHERE id = ?`)
      .bind(now, generationId)
      .run();
    canMarkReady({
      auditStatus: report.status,
      auditClean: report.clean,
      metadataIndexReady: true,
      dimensions: EMBEDDING_DIMENSIONS,
      expectedDimensions: EMBEDDING_DIMENSIONS,
    });
    await ensureGenerationState(db, generationId, "ready", now);
    return { generationId, state: "ready", auditStatus: report.status };
  }
  await ensureGenerationState(db, generationId, "failed", now);
  return { generationId, state: "failed", auditStatus: report.status };
}
