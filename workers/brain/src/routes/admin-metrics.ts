import questionsFile from "../../../../content/northwind/questions.json";
import { writeOperationalLog } from "../../../../src/lib/cf/operational-log";
import { BoundedIdError, parseBoundedId } from "../../../../src/lib/cf/bounded-id";
import { withRequestId } from "../../../../src/lib/cf/request-id";
import { WorkerNotFoundError, WorkerValidationError } from "../../../../src/lib/cf/worker-errors";
import type { DirectoryRecord } from "../../../../src/lib/auth/principal";
import {
  ACTIVITY_OUTCOMES,
  HEALTH_DETAIL_CODES,
  type ActivityOutcome,
  type EvalFailure,
  type EvalsAdminView,
  type HealthDetailCode,
  type HealthResponse,
  type HealthRow,
} from "../../../../src/lib/contracts/admin-metrics";
import { NORTHWIND_CAMPAIGN } from "../../../../src/lib/eval/campaign-snapshot";
import { CAMPAIGN_DOCUMENT_TITLES } from "../../../../src/lib/eval/campaign-titles";
import {
  ACTIVITY_PAGE_DEFAULT,
  ACTIVITY_PAGE_MAX,
  assistantMessageExists,
  loadActivity,
  loadOverview,
  loadUnanswered,
  parseActivityCursor,
} from "../../../../src/lib/store/admin-metrics";
import { activeGenerationId, type SqlExecutor } from "../../../../src/lib/store/corpus-d1";
import type { OperationsDatabase } from "../../../../src/lib/store/conversations";
import { loadLatestServiceHealth } from "../../../../src/lib/store/service-health";
import { loadTurnSteps } from "../../../../src/lib/store/turn-steps";
import { WORKERS_AI_SERVICE } from "../../../../src/lib/models/ai-health";

type MetricsEnv = { CORPUS_DB?: unknown; OPERATIONS_DB: unknown };

function json(body: unknown, requestId: string): Response {
  const response = Response.json(body, { headers: withRequestId(new Headers(), requestId) });
  response.headers.set("cache-control", "no-store");
  return response;
}

function requireSevenDays(url: URL): void {
  const range = url.searchParams.get("range") ?? "7d";
  if (range !== "7d") {
    throw new WorkerValidationError();
  }
}

type AuditRow = { status: string; missing_count: number; orphan_count: number; created_at: number };

async function corpusHealth(corpus: SqlExecutor | undefined): Promise<HealthRow[]> {
  if (!corpus) {
    return [
      { service: "corpus_db", status: "error", detail: "unreachable" },
      { service: "vector_index", status: "error", detail: "unreachable" },
    ];
  }
  let generationId: string | null;
  try {
    await corpus.prepare("SELECT 1").first();
    generationId = await activeGenerationId(corpus);
  } catch {
    return [
      { service: "corpus_db", status: "error", detail: "unreachable" },
      { service: "vector_index", status: "error", detail: "unreachable" },
    ];
  }
  const corpusRow: HealthRow = { service: "corpus_db", status: "ok", detail: "ok" };
  if (!generationId) {
    return [corpusRow, { service: "vector_index", status: "warning", detail: "no_active_generation" }];
  }
  let audit: AuditRow | null;
  try {
    audit = await corpus
      .prepare(
        `SELECT status, missing_count, orphan_count, created_at FROM reconciliation_audits
         WHERE generation_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(generationId)
      .first<AuditRow>();
  } catch {
    return [corpusRow, { service: "vector_index", status: "error", detail: "unreachable" }];
  }
  const vector = (status: HealthRow["status"], detail: HealthDetailCode): HealthRow => ({
    service: "vector_index",
    status,
    detail,
    generationId,
    ...(audit ? { at: audit.created_at } : {}),
  });
  if (!audit) {
    return [corpusRow, vector("warning", "no_audit")];
  }
  if (audit.status === "partial") {
    return [corpusRow, vector("warning", "audit_partial")];
  }
  if (audit.status === "unsupported") {
    return [corpusRow, vector("warning", "audit_unsupported")];
  }
  if (audit.missing_count > 0 || audit.orphan_count > 0) {
    return [corpusRow, vector("error", "drift")];
  }
  return [corpusRow, vector("ok", "synced")];
}

async function loadHealth(env: MetricsEnv): Promise<HealthResponse> {
  const operations = env.OPERATIONS_DB as OperationsDatabase;
  const [corpusRows, aiEvent] = await Promise.all([
    corpusHealth(env.CORPUS_DB as SqlExecutor | undefined),
    loadLatestServiceHealth(operations, WORKERS_AI_SERVICE),
  ]);
  const workersAi: HealthRow = aiEvent
    ? { service: "workers_ai", status: aiEvent.status, detail: aiEvent.code, at: aiEvent.at }
    : { service: "workers_ai", status: "warning", detail: "no_calls_yet" };
  return {
    services: [
      { service: "brain", status: "ok", detail: "ok" },
      ...corpusRows,
      workersAi,
      // Models call the AI binding directly, so the gateway is truthfully off the path (plan D6).
      { service: "ai_gateway", status: "warning", detail: "not_in_call_path" },
    ],
  };
}

type QuestionRecord = {
  id: string;
  query: string;
  principal: string;
  expected_document_ids: string[];
  expected_sections: string[];
  note?: string;
};

const PRIVATE_DOCUMENT_TITLE = "Private document";

/** Titles from the active catalog; a private-owner document is never named; a document the catalog lacks is simply absent. */
async function catalogTitles(
  corpus: SqlExecutor | undefined,
  documentIds: string[],
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  if (!corpus || documentIds.length === 0) {
    return titles;
  }
  const generationId = await activeGenerationId(corpus);
  if (!generationId) {
    return titles;
  }
  const rows = await corpus
    .prepare(
      `SELECT document_id, title, access_scope FROM document_catalog
       WHERE generation_id = ? AND document_id IN (${documentIds.map(() => "?").join(",")})`,
    )
    .bind(generationId, ...documentIds)
    .all<{ document_id: string; title: string; access_scope: string }>();
  for (const row of rows.results) {
    titles.set(row.document_id, row.access_scope === "private" ? PRIVATE_DOCUMENT_TITLE : row.title);
  }
  return titles;
}

async function evalsView(corpus: SqlExecutor | undefined): Promise<EvalsAdminView> {
  const latest = NORTHWIND_CAMPAIGN.runs.find((run) => run.key === NORTHWIND_CAMPAIGN.latestKey);
  if (!latest) {
    throw new Error("campaign snapshot has no latest run");
  }
  const byId = new Map((questionsFile.questions as QuestionRecord[]).map((item) => [item.id, item]));
  const expectedIds = [
    ...new Set(
      latest.failures.flatMap((failure) => byId.get(failure.id)?.expected_document_ids ?? []),
    ),
  ];
  const catalog = await catalogTitles(corpus, expectedIds);
  const titleOf = (documentId: string) =>
    catalog.get(documentId) ?? CAMPAIGN_DOCUMENT_TITLES[documentId] ?? documentId;
  const failures: EvalFailure[] = latest.failures.map((failure) => {
    const question = byId.get(failure.id);
    if (!question) {
      throw new Error(`campaign failure ${failure.id} is missing from questions.json`);
    }
    return {
      id: failure.id,
      category: failure.category,
      detail: failure.detail,
      question: question.query,
      askedAs: question.principal,
      expected: question.expected_document_ids.map((documentId, index) => ({
        documentId,
        title: titleOf(documentId),
        section: question.expected_sections[index] ?? null,
      })),
      note: question.note ?? "",
    };
  });
  return {
    title: NORTHWIND_CAMPAIGN.title,
    model: NORTHWIND_CAMPAIGN.model,
    questions: NORTHWIND_CAMPAIGN.questions,
    documents: NORTHWIND_CAMPAIGN.documents,
    latestKey: NORTHWIND_CAMPAIGN.latestKey,
    runs: NORTHWIND_CAMPAIGN.runs.map((run) => ({
      key: run.key,
      label: run.label,
      date: run.date,
      passed: run.passed,
      scored: run.scored,
      passRate: run.passRate,
      note: run.note,
    })),
    categories: latest.categories,
    retrieval: NORTHWIND_CAMPAIGN.retrieval,
    failures,
  };
}

/** Admin-only campaign read-out behind GET /evaluations?view=campaign. The caller has checked admin. */
export async function campaignView(env: MetricsEnv): Promise<EvalsAdminView> {
  return evalsView(env.CORPUS_DB as SqlExecutor | undefined);
}

/**
 * Admin metrics routes. The /admin/ gate in index.ts has already required admin.
 * Returns null for paths it does not own.
 */
export async function handleAdminMetricsRoute(input: {
  request: Request;
  path: string;
  env: MetricsEnv;
  principal: DirectoryRecord;
  requestId: string;
  started: number;
}): Promise<Response | null> {
  const { request, path, env, principal, requestId, started } = input;
  if (request.method !== "GET") {
    return null;
  }
  const traceMatch = path.match(/^\/admin\/activity\/([^/]+)$/);
  const owned =
    path === "/admin/overview" ||
    path === "/admin/unanswered" ||
    path === "/admin/health" ||
    path === "/admin/activity" ||
    traceMatch !== null;
  if (!owned) {
    return null;
  }
  const url = new URL(request.url);
  const operations = env.OPERATIONS_DB as OperationsDatabase;
  const now = Date.now();
  const done = (operation: string) =>
    writeOperationalLog({
      requestId,
      principalKind: principal.kind,
      operation,
      status: "ok",
      durationMs: Date.now() - started,
    });

  if (path === "/admin/overview") {
    requireSevenDays(url);
    const body = await loadOverview(operations, now);
    done("admin-overview");
    return json(body, requestId);
  }

  if (path === "/admin/unanswered") {
    requireSevenDays(url);
    const questions = await loadUnanswered(operations, now);
    done("admin-unanswered");
    return json({ range: "7d", questions }, requestId);
  }

  if (path === "/admin/health") {
    const body = await loadHealth(env);
    for (const row of body.services) {
      if (!(HEALTH_DETAIL_CODES as readonly string[]).includes(row.detail)) {
        throw new Error("health detail code is not in the closed set");
      }
    }
    done("admin-health");
    return json(body, requestId);
  }

  if (path === "/admin/activity") {
    requireSevenDays(url);
    const outcomeParam = url.searchParams.get("outcome");
    if (outcomeParam !== null && outcomeParam !== "" && !ACTIVITY_OUTCOMES.includes(outcomeParam as ActivityOutcome)) {
      throw new WorkerValidationError();
    }
    const cursorParam = url.searchParams.get("cursor");
    const cursor = cursorParam ? parseActivityCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      throw new WorkerValidationError();
    }
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam === null ? ACTIVITY_PAGE_DEFAULT : Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > ACTIVITY_PAGE_MAX) {
      throw new WorkerValidationError();
    }
    const body = await loadActivity(operations, {
      now,
      outcome: outcomeParam ? (outcomeParam as ActivityOutcome) : null,
      cursor,
      limit,
    });
    done("admin-activity");
    return json(body, requestId);
  }

  let messageId: string;
  try {
    messageId = parseBoundedId(decodeURIComponent(traceMatch![1]), "message id");
  } catch (error) {
    if (error instanceof BoundedIdError || error instanceof URIError) {
      throw new WorkerNotFoundError();
    }
    throw error;
  }
  if (!(await assistantMessageExists(operations, messageId))) {
    throw new WorkerNotFoundError();
  }
  const steps = await loadTurnSteps(operations, messageId);
  done("admin-activity-trace");
  return json({ messageId, steps }, requestId);
}
