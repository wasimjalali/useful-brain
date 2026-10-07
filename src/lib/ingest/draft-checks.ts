import {
  aclFilterFor,
  aclSqlAndParams,
  canAccessChunk,
  type Principal,
} from "../acl/access";
import { aclGroupKey, type AccessScope } from "../acl/acl-group";
import type { WorkersAiRunner } from "../embeddings/workers-ai-embed";
import { generationNamespace } from "./digests";
import { rankedDocumentIds, recall } from "../eval/metrics";
import {
  CloudflareKnowledgePipeline,
  loadChunks,
  type CorpusSql,
  type VectorizeIndex,
} from "../retrieve/cloudflare-pipeline";
import { WorkersAiReranker } from "../retrieve/workers-ai-reranker";
import { auditStoreConsistency } from "../store/inventory-audit";
import { loadExpectedVectorIds, recordAudit, type SqlExecutor } from "../store/corpus-d1";
import { mutationReached } from "../store/vectorize-projection";
import type { VectorPort } from "./draft-index";

/** Draft checks per UTC day. Above it a draft waits as "paused". */
export const DRAFT_CHECKS_PER_DAY = 10;
/** Recorded live retrieved recall is 0.995 (campaign snapshot); a draft may not drop far below it. */
export const DRAFT_LIVE_RECALL_FLOOR = 0.95;
export const RETRIEVAL_BATCH = 20;
const VECTOR_GET_LIMIT = 20;

/** Retryable: the index has not processed our newest mutation yet. */
export class MutationPendingError extends Error {
  constructor() {
    super("Vectorize has not processed the newest mutation yet");
    this.name = "MutationPendingError";
  }
}

export type ReconcileOutcome = {
  mode: "ledger_getbyids" | "keyword_only";
  reconciled: boolean;
  status: "complete" | "partial" | "unsupported";
  missing: number;
  expected: number;
};

function chunksOf<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

/**
 * Reconciles the draft's D1 vector ledger with the index. With a Vectorize
 * binding: waits (by retry) until the index reports it processed the newest
 * recorded mutation, then fetches every ledger id back and checks namespace and
 * ACL metadata. The binding has no list call, so orphan vectors cannot be
 * enumerated here; that gap is part of the recorded mode. With no binding
 * (keyword-only) there are no vectors, so the audit is recorded as empty and
 * clean with mode "keyword_only". That path is never taken when a binding exists.
 */
export async function reconcileDraft(
  input: { db: SqlExecutor; vectors: VectorPort | null; generationId: string; now?: number },
): Promise<ReconcileOutcome> {
  const now = input.now ?? Date.now();
  const { db, vectors, generationId } = input;
  const expected = await loadExpectedVectorIds(db, generationId);
  const expectedCount = Object.keys(expected).length;
  if (!vectors) {
    // No vectors exist in a keyword-only environment, so there is nothing to
    // reconcile. Record an empty, clean, complete audit and say so in the mode.
    const report = auditStoreConsistency({
      inventoryWatermark: () => null,
      expectedVectorIds: () => ({}),
      vectorIds: () => [],
    });
    await recordAudit(db, generationId, report, now);
    return { mode: "keyword_only", reconciled: report.clean, status: report.status, missing: 0, expected: expectedCount };
  }
  const newest = await db
    .prepare(
      `SELECT mutation_id FROM vector_mutations WHERE generation_id = ? ORDER BY rowid DESC LIMIT 1`,
    )
    .bind(generationId)
    .first<{ mutation_id: string }>();
  const processedBefore = String((await vectors.describe()).processedUpToMutation ?? "");
  if (newest && !mutationReached(newest.mutation_id, processedBefore)) {
    throw new MutationPendingError();
  }
  const aclRows = await db
    .prepare(`SELECT vector_id, acl_group FROM chunks WHERE generation_id = ?`)
    .bind(generationId)
    .all<{ vector_id: string; acl_group: string }>();
  const aclByVector = new Map(aclRows.results.map((row) => [row.vector_id, row.acl_group]));
  const namespace = await generationNamespace(generationId);
  const present: string[] = [];
  for (const batch of chunksOf(Object.keys(expected), VECTOR_GET_LIMIT)) {
    for (const vector of await vectors.getByIds(batch)) {
      const wrongNamespace = vector.namespace !== undefined && vector.namespace !== namespace;
      const wrongAcl =
        vector.metadata !== undefined && vector.metadata.acl_group !== aclByVector.get(vector.id);
      if (!wrongNamespace && !wrongAcl && expected[vector.id] !== undefined) {
        present.push(vector.id);
      }
    }
  }
  const processedAfter = String((await vectors.describe()).processedUpToMutation ?? "");
  const report = auditStoreConsistency({
    inventoryWatermark: (() => {
      const marks = [newest ? processedBefore : null, newest ? processedAfter : null];
      let call = 0;
      return () => marks[call++] ?? null;
    })(),
    expectedVectorIds: () => expected,
    vectorIds: () => present,
  });
  await recordAudit(db, generationId, report, now);
  return {
    mode: "ledger_getbyids",
    reconciled: report.clean,
    status: report.status,
    missing: report.missingVectors.length,
    expected: expectedCount,
  };
}

export type AclProbeDocument = {
  documentId: string;
  accessScope: Exclude<AccessScope, "private">;
  allowedRoles: string[];
  allowedDepartments: string[];
};

type ProbeChunk = {
  chunk_id: string;
  access_scope: string;
  allowed_roles: string;
  allowed_departments: string;
  acl_group: string;
  metadata: string;
};

function expectedAccess(document: AclProbeDocument, probe: Principal): boolean {
  if (document.accessScope === "public") {
    return true;
  }
  if (document.accessScope === "department") {
    return document.allowedDepartments.some((department) => probe.departments.includes(department));
  }
  return document.allowedRoles.some((role) => probe.roles.includes(role));
}

function probePrincipals(document: AclProbeDocument): Principal[] {
  const probes: Principal[] = [
    { userId: "probe-outsider", roles: ["standard"], departments: ["__none__"] },
    { userId: "probe-empty", roles: [], departments: [] },
  ];
  for (const department of document.allowedDepartments) {
    probes.push({ userId: `probe-dept-${department}`, roles: ["standard"], departments: [department] });
  }
  for (const role of document.allowedRoles) {
    probes.push({ userId: `probe-role-${role}`, roles: [role], departments: ["__none__"] });
  }
  return probes;
}

/**
 * Per-upload ACL parity probe. The stored chunk ACL must equal the selection,
 * and for each probe principal the SQL predicate retrieval uses, the
 * canAccessChunk oracle and the selection itself must all agree. A chunk that
 * either implementation allows but the selection denies is a leak.
 */
export async function aclParityProbe(
  db: SqlExecutor,
  generationId: string,
  documents: AclProbeDocument[],
): Promise<{ leaks: number; parityErrors: number; probes: number }> {
  let leaks = 0;
  let parityErrors = 0;
  let probes = 0;
  for (const document of documents) {
    const rows = (
      await db
        .prepare(
          `SELECT chunk_id, access_scope, allowed_roles, allowed_departments, acl_group, metadata
           FROM chunks WHERE generation_id = ? AND document_id = ?`,
        )
        .bind(generationId, document.documentId)
        .all<ProbeChunk>()
    ).results;
    const expectedKey = await aclGroupKey({
      accessScope: document.accessScope,
      allowedRoles: document.allowedRoles,
      allowedDepartments: document.allowedDepartments,
      ownerUserId: "",
    });
    const sortedRoles = JSON.stringify([...document.allowedRoles].sort());
    const sortedDepartments = JSON.stringify([...document.allowedDepartments].sort());
    for (const row of rows) {
      const storedMatches =
        row.access_scope === document.accessScope &&
        JSON.stringify((JSON.parse(row.allowed_roles) as string[]).slice().sort()) === sortedRoles &&
        JSON.stringify((JSON.parse(row.allowed_departments) as string[]).slice().sort()) ===
          sortedDepartments &&
        row.acl_group === expectedKey;
      if (!storedMatches) {
        // A stored ACL that differs from the selection could expose the chunk.
        leaks += 1;
      }
    }
    for (const probe of probePrincipals(document)) {
      probes += 1;
      const acl = aclFilterFor(probe);
      const { sql, params } = aclSqlAndParams(acl);
      const sqlAllowed = new Set(
        (
          await db
            .prepare(
              `SELECT c.chunk_id FROM chunks c WHERE c.generation_id = ? AND c.document_id = ? AND ${sql}`,
            )
            .bind(generationId, document.documentId, ...params)
            .all<{ chunk_id: string }>()
        ).results.map((row) => row.chunk_id),
      );
      const wanted = expectedAccess(document, probe);
      for (const row of rows) {
        const oracle = canAccessChunk(probe, {
          accessScope: row.access_scope,
          allowedRoles: JSON.parse(row.allowed_roles) as string[],
          allowedDepartments: JSON.parse(row.allowed_departments) as string[],
          metadata: JSON.parse(row.metadata) as Record<string, unknown>,
        }).allowed;
        const viaSql = sqlAllowed.has(row.chunk_id);
        if ((viaSql || oracle) && !wanted) {
          leaks += 1;
        } else if (wanted && (!viaSql || !oracle)) {
          parityErrors += 1;
        }
      }
    }
  }
  return { leaks, parityErrors, probes };
}

export type EvalFixture = {
  principals: Record<string, { user_id?: string; roles?: string[]; departments?: string[] }>;
  questions: Array<{
    id: string;
    category: string;
    query: string;
    principal: string;
    expected_document_ids?: string[];
    forbidden_document_ids?: string[];
  }>;
};

const ABSTENTION = new Set(["permission", "unanswerable"]);
const REQUIRE_ALL = new Set(["multi_hop", "multi_hop_expanded"]);
const RETRIEVAL_TOP_K = 8;

export type RetrievalBatchResult = {
  run: number;
  leaks: number;
  recallSum: number;
  rankedCount: number;
};

/**
 * Retrieval and ACL guard over questions [from, to) of the locked Northwind
 * set, run against the draft generation. Retrieval only: no answer model.
 */
export async function runRetrievalBatch(input: {
  db: SqlExecutor;
  ai: WorkersAiRunner;
  /** Null in keyword-only environments: the pipeline then searches the keyword channel alone. */
  vectorize: VectorizeIndex | null;
  generationId: string;
  fixture: EvalFixture;
  from: number;
  to: number;
}): Promise<RetrievalBatchResult> {
  const pipeline = new CloudflareKnowledgePipeline({
    db: input.db as unknown as CorpusSql,
    vectorize: input.vectorize,
    ai: input.ai,
    reranker: new WorkersAiReranker(input.ai),
    generationId: input.generationId,
  });
  const result: RetrievalBatchResult = { run: 0, leaks: 0, recallSum: 0, rankedCount: 0 };
  for (const question of input.fixture.questions.slice(input.from, input.to)) {
    const named = input.fixture.principals[question.principal];
    if (!named) {
      throw new Error(`question ${question.id} names an unknown principal`);
    }
    const principal: Principal = {
      userId: named.user_id ?? question.principal,
      roles: named.roles ?? [],
      departments: named.departments ?? [],
    };
    const response = await pipeline.search({ query: question.query, principal, topK: RETRIEVAL_TOP_K, candidateLimit: 24 });
    const ranked = rankedDocumentIds(response.hits.map((hit) => hit.citation.documentId));
    const forbidden = new Set(question.forbidden_document_ids ?? []);
    const stored = await loadChunks(
      input.db as unknown as CorpusSql,
      response.hits.map((hit) => hit.chunkId),
    );
    const leaked =
      ranked.some((id) => forbidden.has(id)) ||
      stored.some((chunk) => !canAccessChunk(principal, chunk).allowed);
    result.run += 1;
    result.leaks += leaked ? 1 : 0;
    if (!ABSTENTION.has(question.category)) {
      result.rankedCount += 1;
      result.recallSum += recall(ranked, question.expected_document_ids ?? [], REQUIRE_ALL.has(question.category));
    }
  }
  return result;
}

export function aggregateRecall(batches: RetrievalBatchResult[]): {
  questionsRun: number;
  leaks: number;
  liveRecall: number | null;
} {
  const rankedCount = batches.reduce((sum, batch) => sum + batch.rankedCount, 0);
  const recallSum = batches.reduce((sum, batch) => sum + batch.recallSum, 0);
  return {
    questionsRun: batches.reduce((sum, batch) => sum + batch.run, 0),
    leaks: batches.reduce((sum, batch) => sum + batch.leaks, 0),
    liveRecall: rankedCount === 0 ? null : recallSum / rankedCount,
  };
}

function startOfUtcDay(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Starts (or resumes) the check row for a draft. A draft gets one run; once
 * DRAFT_CHECKS_PER_DAY runs have started in the UTC day, new drafts wait as paused.
 */
export async function reserveCheckRun(
  db: SqlExecutor,
  generationId: string,
  now = Date.now(),
): Promise<"started" | "paused" | "existing"> {
  const current = await db
    .prepare(`SELECT status FROM draft_checks WHERE generation_id = ?`)
    .bind(generationId)
    .first<{ status: string }>();
  if (current && current.status !== "paused") {
    return "existing";
  }
  const used = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM draft_checks
       WHERE started_at >= ? AND status <> 'paused' AND generation_id <> ?`,
    )
    .bind(startOfUtcDay(now), generationId)
    .first<{ n: number }>();
  const status = (used?.n ?? 0) >= DRAFT_CHECKS_PER_DAY ? "paused" : "running";
  await db
    .prepare(
      `INSERT INTO draft_checks (generation_id, status, started_at) VALUES (?, ?, ?)
       ON CONFLICT(generation_id) DO UPDATE SET status = excluded.status, started_at = excluded.started_at`,
    )
    .bind(generationId, status, now)
    .run();
  return status === "paused" ? "paused" : "started";
}

export async function finishCheckRun(
  db: SqlExecutor,
  generationId: string,
  result: {
    status: "passed" | "failed";
    reconciled: boolean;
    mode: "ledger_getbyids" | "keyword_only";
    aclLeaks: number;
    liveRecall: number | null;
    questionsRun: number;
    errorCode: string | null;
  },
  now = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE draft_checks SET status = ?, reconciled = ?, reconcile_mode = ?, acl_leaks = ?,
         live_recall = ?, questions_run = ?, error_code = ?, finished_at = ?
       WHERE generation_id = ?`,
    )
    .bind(
      result.status,
      result.reconciled ? 1 : 0,
      result.mode,
      result.aclLeaks,
      result.liveRecall,
      result.questionsRun,
      result.errorCode,
      now,
      generationId,
    )
    .run();
}

export function decideChecks(input: {
  reconciled: boolean;
  aclLeaks: number;
  parityErrors: number;
  liveRecall: number | null;
  retrievalAvailable: boolean;
  documentsAdded: number | null;
}): { status: "passed" | "failed"; errorCode: string | null } {
  if (!input.reconciled) {
    return { status: "failed", errorCode: "RECONCILIATION_FAILED" };
  }
  if (input.aclLeaks > 0) {
    return { status: "failed", errorCode: "ACL_LEAK" };
  }
  if (input.parityErrors > 0) {
    return { status: "failed", errorCode: "ACL_PARITY" };
  }
  if (!input.retrievalAvailable || input.liveRecall === null) {
    return { status: "failed", errorCode: "RETRIEVAL_UNAVAILABLE" };
  }
  if (input.liveRecall < DRAFT_LIVE_RECALL_FLOOR) {
    return { status: "failed", errorCode: "RECALL_BELOW_FLOOR" };
  }
  if (input.documentsAdded === 0) {
    return { status: "failed", errorCode: "NOTHING_ADDED" };
  }
  return { status: "passed", errorCode: null };
}
