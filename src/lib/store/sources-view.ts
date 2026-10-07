import type {
  DraftState,
  SourcesActive,
  SourcesDocument,
  SourcesDraft,
  SourcesResponse,
} from "../contracts/sources";
import { uploadErrorMessage } from "../ingest/error-codes";
import { activeGenerationId, type SqlExecutor } from "./corpus-d1";
import { readersOf } from "./library-queries";

const PRIVATE_TITLE = "Private document";

type CatalogRow = {
  document_id: string;
  title: string;
  file_name: string;
  department: string | null;
  access_scope: string;
  allowed_roles: string;
  allowed_departments: string;
  chunk_count: number;
  updated_at: number;
};

type DraftRow = { generation_id: string; kind: "upload" | "reindex"; base_generation_id: string | null; state: string };

type CheckRow = {
  status: "running" | "passed" | "failed" | "paused";
  reconciled: number;
  acl_leaks: number | null;
  live_recall: number | null;
  error_code: string | null;
};

const CATALOG_SELECT = `SELECT document_id, title, file_name, department, access_scope,
  allowed_roles, allowed_departments, chunk_count, updated_at
  FROM document_catalog WHERE generation_id = ?`;

/**
 * Private-owner documents never show a title to anyone, admins included:
 * the row keeps its chunk count and status only.
 */
function toDocument(row: CatalogRow, status: SourcesDocument["status"]): SourcesDocument {
  const isPrivate = row.access_scope === "private";
  return {
    id: row.document_id,
    title: isPrivate ? PRIVATE_TITLE : row.title,
    fileName: isPrivate ? "" : row.file_name,
    department: isPrivate ? null : row.department,
    readers: readersOf(row),
    chunks: row.chunk_count,
    updatedAt: row.updated_at,
    status,
  };
}

function draftState(generationState: string, check: CheckRow | null): DraftState {
  if (generationState === "failed") {
    return "failed";
  }
  if (generationState === "draft" || generationState === "indexing") {
    return "building";
  }
  if (check?.status === "paused") {
    return "checks_paused";
  }
  if (check?.status === "failed") {
    return "checks_failed";
  }
  if (generationState === "ready" && check?.status === "passed") {
    return "checks_passed";
  }
  return "checking";
}

async function loadActive(db: SqlExecutor, activeId: string): Promise<SourcesActive | null> {
  const generation = await db
    .prepare(`SELECT updated_at FROM corpus_generations WHERE id = ?`)
    .bind(activeId)
    .first<{ updated_at: number }>();
  if (!generation) {
    return null;
  }
  const counts = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM document_catalog WHERE generation_id = ?) AS documents,
              (SELECT COUNT(*) FROM chunks WHERE generation_id = ?) AS chunks,
              (SELECT COUNT(*) FROM vector_mutations
                WHERE generation_id = ? AND mutation_id NOT LIKE 'seed-%') AS mutations`,
    )
    .bind(activeId, activeId, activeId)
    .first<{ documents: number; chunks: number; mutations: number }>();
  return {
    id: activeId,
    promotedAt: generation.updated_at,
    documents: counts?.documents ?? 0,
    chunks: counts?.chunks ?? 0,
    retrieval: (counts?.mutations ?? 0) > 0 ? "hybrid" : "keyword",
  };
}

/** The newest draft that is still open, or failed on its own (a discard hides it). */
async function loadVisibleDraft(db: SqlExecutor): Promise<DraftRow | null> {
  return db
    .prepare(
      `SELECT d.generation_id, d.kind, d.base_generation_id, g.state
       FROM drafts d JOIN corpus_generations g ON g.id = d.generation_id
       WHERE g.state IN ('draft', 'indexing', 'reconciling', 'ready')
          OR (g.state = 'failed' AND COALESCE(g.error_code, '') <> 'DISCARDED')
       ORDER BY d.created_at DESC, d.rowid DESC LIMIT 1`,
    )
    .first<DraftRow>();
}

async function loadDraftSummary(db: SqlExecutor, draft: DraftRow): Promise<SourcesDraft> {
  const check = await db
    .prepare(
      `SELECT status, reconciled, acl_leaks, live_recall, error_code FROM draft_checks WHERE generation_id = ?`,
    )
    .bind(draft.generation_id)
    .first<CheckRow>();
  const files = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN f.stage <> 'failed' THEN COALESCE(f.chunks_embedded, 0) END), 0) AS embedded,
              COALESCE(SUM(CASE WHEN f.stage <> 'failed' THEN COALESCE(f.chunks_total, 0) END), 0) AS total,
              COALESCE(SUM(CASE WHEN f.stage <> 'failed' THEN 1 ELSE 0 END), 0) AS documents,
              COALESCE(SUM(CASE WHEN f.stage = 'failed' THEN 1 ELSE 0 END), 0) AS failed
       FROM upload_files f JOIN upload_batches b ON b.id = f.batch_id WHERE b.generation_id = ?`,
    )
    .bind(draft.generation_id)
    .first<{ embedded: number; total: number; documents: number; failed: number }>();
  let embedded = files?.embedded ?? 0;
  let total = files?.total ?? 0;
  let documents = files?.documents ?? 0;
  if (draft.kind === "reindex") {
    const counts = await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM chunks WHERE generation_id = ?) AS embedded,
                (SELECT COUNT(*) FROM chunks WHERE generation_id = ?) AS total,
                (SELECT COUNT(*) FROM document_catalog WHERE generation_id = ?) AS documents`,
      )
      .bind(draft.generation_id, draft.base_generation_id ?? "", draft.base_generation_id ?? "")
      .first<{ embedded: number; total: number; documents: number }>();
    embedded = counts?.embedded ?? 0;
    total = counts?.total ?? 0;
    documents = counts?.documents ?? 0;
  }
  const finished = check && (check.status === "passed" || check.status === "failed");
  return {
    id: draft.generation_id,
    kind: draft.kind,
    state: draftState(draft.state, check),
    embeddedChunks: embedded,
    totalChunks: total,
    documents,
    failedFiles: files?.failed ?? 0,
    ...(finished
      ? {
          checks: {
            reconciled: check.reconciled === 1,
            aclLeaks: check.acl_leaks ?? 0,
            liveRecall: check.live_recall,
            errorCode: check.error_code,
          },
        }
      : {}),
  };
}

type UploadRow = {
  id: string;
  file_name: string;
  document_id: string;
  stage: string;
  error_code: string | null;
  chunks_total: number | null;
  updated_at: number;
  access_scope: string;
  allowed_roles: string;
  allowed_departments: string;
};

async function loadDocuments(
  db: SqlExecutor,
  activeId: string | null,
  draft: DraftRow | null,
): Promise<SourcesDocument[]> {
  const byId = new Map<string, SourcesDocument>();
  if (activeId) {
    const rows = await db.prepare(CATALOG_SELECT).bind(activeId).all<CatalogRow>();
    for (const row of rows.results) {
      byId.set(row.document_id, toDocument(row, "active"));
    }
  }
  const failed: SourcesDocument[] = [];
  if (draft) {
    const uploads = await db
      .prepare(
        `SELECT f.id, f.file_name, f.document_id, f.stage, f.error_code, f.chunks_total, f.updated_at,
                b.access_scope, b.allowed_roles, b.allowed_departments
         FROM upload_files f JOIN upload_batches b ON b.id = f.batch_id
         WHERE b.generation_id = ? ORDER BY f.created_at, f.rowid`,
      )
      .bind(draft.generation_id)
      .all<UploadRow>();
    const catalog = await db.prepare(CATALOG_SELECT).bind(draft.generation_id).all<CatalogRow>();
    const draftRows = new Map(catalog.results.map((row) => [row.document_id, row]));
    for (const file of uploads.results) {
      if (file.stage === "failed") {
        failed.push({
          id: file.id,
          title: file.file_name,
          fileName: file.file_name,
          department: null,
          readers: readersOf(file),
          chunks: 0,
          updatedAt: file.updated_at,
          status: "failed",
          errorMessage: uploadErrorMessage(file.error_code ?? "INTERNAL"),
        });
        continue;
      }
      const row = draftRows.get(file.document_id);
      byId.set(
        file.document_id,
        row
          ? toDocument(row, "draft")
          : {
              id: file.document_id,
              title: file.file_name,
              fileName: file.file_name,
              department: null,
              readers: readersOf(file),
              chunks: file.chunks_total ?? 0,
              updatedAt: file.updated_at,
              status: "draft",
            },
      );
    }
  }
  return [...byId.values(), ...failed].sort(
    (left, right) =>
      left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) ||
      left.id.localeCompare(right.id),
  );
}

export async function buildSourcesView(db: SqlExecutor): Promise<SourcesResponse> {
  const activeId = await activeGenerationId(db);
  const draftRow = await loadVisibleDraft(db);
  return {
    active: activeId ? await loadActive(db, activeId) : null,
    draft: draftRow ? await loadDraftSummary(db, draftRow) : null,
    documents: await loadDocuments(db, activeId, draftRow),
  };
}
