import {
  ACTIVITY_OUTCOMES,
  type ActivityOutcome,
  type ActivityResponse,
  type ActivityRow,
  type OverviewDay,
  type OverviewResponse,
  type OverviewTotals,
  type UnansweredQuestion,
} from "../contracts/admin-metrics";
import type { OperationsDatabase } from "./conversations";
import { normalizeRequestQuestion } from "./document-requests";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = 7;
const MAX_UNANSWERED = 20;
const MAX_QUESTION_CHARS = 300;

export const ACTIVITY_PAGE_DEFAULT = 25;
export const ACTIVITY_PAGE_MAX = 50;

/** Range start for the 7-day window: UTC midnight, six days before today's. */
export function windowStart(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS - (DAYS - 1) * DAY_MS;
}

export type TurnMetricRow = {
  created_at: number;
  answer_type: string | null;
  latency_ms: number | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function totals(rows: TurnMetricRow[]): OverviewTotals {
  const grounded = rows.filter((row) => row.answer_type === "grounded").length;
  const latencies = rows.flatMap((row) => (row.latency_ms === null ? [] : [row.latency_ms]));
  return {
    questions: rows.length,
    grounded,
    groundedPercent: rows.length === 0 ? null : Math.round((grounded / rows.length) * 1000) / 10,
    noEvidence: rows.filter((row) => row.answer_type === "insufficient_evidence").length,
    medianLatencyMs: median(latencies),
    latencySamples: latencies.length,
  };
}

/** Pure: rows may span both windows. Medians are computed here, SQLite has none. */
export function computeOverview(rows: TurnMetricRow[], now: number): OverviewResponse {
  const start = windowStart(now);
  const current = rows.filter((row) => row.created_at >= start && row.created_at <= now);
  const previous = rows.filter((row) => row.created_at >= start - DAYS * DAY_MS && row.created_at < start);
  const daily: OverviewDay[] = Array.from({ length: DAYS }, (_, index) => {
    const dayStart = start + index * DAY_MS;
    const inDay = current.filter((row) => row.created_at >= dayStart && row.created_at < dayStart + DAY_MS);
    return { day: new Date(dayStart).toISOString().slice(0, 10), ...totals(inDay) };
  });
  return {
    range: "7d",
    generatedAt: now,
    current: totals(current),
    previous: totals(previous),
    daily,
  };
}

/**
 * One row per asked question: when a saved user message has several attempts
 * (a failed answer and its retry), only the newest completed one counts, else
 * the newest failed one. The same rule the conversation view uses, so Overview
 * and Activity agree with each other and with what the asker sees.
 */
function latestAttempt(alias: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM messages n
    WHERE n.parent_user_message_id = ${alias}.parent_user_message_id
      AND n.role = 'assistant' AND n.id <> ${alias}.id
      AND n.status IN ('completed', 'failed')
      AND (
        (n.status = 'completed' AND ${alias}.status = 'failed')
        OR (n.status = ${alias}.status
            AND (n.created_at > ${alias}.created_at
                 OR (n.created_at = ${alias}.created_at AND n.id > ${alias}.id)))
      )
  )`;
}

/** Completed or failed assistant turns only, one per question. Pending turns are not yet an outcome. */
export async function loadOverview(db: OperationsDatabase, now: number): Promise<OverviewResponse> {
  const { results } = await db
    .prepare(
      `SELECT m.created_at AS created_at, m.answer_type AS answer_type, m.latency_ms AS latency_ms
       FROM messages m
       WHERE m.role = 'assistant' AND m.status IN ('completed', 'failed')
         AND m.created_at >= ? AND m.created_at <= ?
         AND ${latestAttempt("m")}`,
    )
    .bind(windowStart(now) - DAYS * DAY_MS, now)
    .all<TurnMetricRow>();
  return computeOverview(results, now);
}

type UnansweredRow = {
  created_at: number;
  question: string | null;
  best_candidate_department: string | null;
};

export async function loadUnanswered(
  db: OperationsDatabase,
  now: number,
): Promise<UnansweredQuestion[]> {
  const { results } = await db
    .prepare(
      `SELECT m.created_at AS created_at, q.content AS question,
              m.best_candidate_department AS best_candidate_department
       FROM messages m
       JOIN messages q ON q.id = m.parent_user_message_id AND q.role = 'user'
       WHERE m.role = 'assistant' AND m.status = 'completed'
         AND m.answer_type = 'insufficient_evidence'
         AND m.created_at >= ? AND m.created_at <= ?
       ORDER BY m.created_at DESC, m.id DESC`,
    )
    .bind(windowStart(now), now)
    .all<UnansweredRow>();

  const groups = new Map<string, UnansweredQuestion>();
  for (const row of results) {
    if (!row.question) {
      continue;
    }
    const key = normalizeRequestQuestion(row.question);
    if (!key) {
      continue;
    }
    // Rows arrive newest first: the first row of a group carries the latest wording.
    const group = groups.get(key);
    if (group) {
      group.asks += 1;
      if (!group.likelyDepartment && row.best_candidate_department) {
        group.likelyDepartment = row.best_candidate_department;
      }
    } else {
      groups.set(key, {
        question: row.question.trim().replace(/\s+/g, " ").slice(0, MAX_QUESTION_CHARS),
        asks: 1,
        lastAskedAt: row.created_at,
        requests: 0,
        ...(row.best_candidate_department ? { likelyDepartment: row.best_candidate_department } : {}),
      });
    }
  }
  if (groups.size === 0) {
    return [];
  }

  const keys = [...groups.keys()];
  const requestCounts = new Map<string, number>();
  for (let offset = 0; offset < keys.length; offset += 50) {
    const batch = keys.slice(offset, offset + 50);
    const counted = await db
      .prepare(
        `SELECT question_normalized AS key, COUNT(*) AS n FROM document_requests
         WHERE question_normalized IN (${batch.map(() => "?").join(",")})
         GROUP BY question_normalized`,
      )
      .bind(...batch)
      .all<{ key: string; n: number }>();
    for (const item of counted.results) {
      requestCounts.set(item.key, item.n);
    }
  }
  for (const [key, group] of groups) {
    group.requests = requestCounts.get(key) ?? 0;
  }
  return [...groups.values()]
    .sort((a, b) => b.asks - a.asks || b.lastAskedAt - a.lastAskedAt)
    .slice(0, MAX_UNANSWERED);
}

/**
 * Outcome precedence: a recorded approval decision, then a failed or unavailable
 * turn, then no evidence, then answered. The categories partition the turns.
 */
const ACTIVITY_CTE = `
  WITH activity AS (
    SELECT m.id AS id, m.created_at AS created_at, m.latency_ms AS latency_ms,
           COALESCE(u.name, p.subject) AS person,
           COALESCE(q.content, '') AS question,
           (SELECT COUNT(DISTINCT COALESCE(e.document_id, e.source))
              FROM evidence_snapshots e
              WHERE e.message_id = m.id
                AND e.citation_label IN (
                  SELECT c.value
                  FROM json_each(CASE WHEN json_valid(m.structured_paragraphs_json)
                                       AND json_type(m.structured_paragraphs_json) = 'array'
                                      THEN m.structured_paragraphs_json ELSE '[]' END) p,
                       json_each(p.value, '$.citations') c
                )) AS sources,
           CASE
             WHEN ap.status = 'approved' THEN 'approved'
             WHEN ap.status = 'rejected' THEN 'denied'
             WHEN m.status = 'failed' OR m.answer_type = 'unavailable' THEN 'error'
             WHEN m.answer_type = 'insufficient_evidence' THEN 'no_evidence'
             ELSE 'answered'
           END AS outcome
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN principals p ON p.id = c.owner_principal_id
    LEFT JOIN auth_users u ON u.id = p.id
    LEFT JOIN messages q ON q.id = m.parent_user_message_id
    LEFT JOIN approvals ap ON ap.run_id = (
      SELECT r.id FROM agent_runs r WHERE r.evidence_message_id = m.id
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1
    )
    WHERE m.role = 'assistant' AND m.status IN ('completed', 'failed')
      AND m.created_at >= ? AND m.created_at <= ?
      AND ${latestAttempt("m")}
  )`;

type ActivitySqlRow = {
  id: string;
  created_at: number;
  latency_ms: number | null;
  person: string;
  question: string;
  sources: number;
  outcome: ActivityOutcome;
};

const CURSOR_PATTERN = /^(\d{1,16})~([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;

export function encodeActivityCursor(row: { created_at: number; id: string }): string {
  return `${row.created_at}~${row.id}`;
}

export function parseActivityCursor(value: string): { createdAt: number; id: string } | null {
  const match = CURSOR_PATTERN.exec(value);
  return match ? { createdAt: Number(match[1]), id: match[2] } : null;
}

export async function loadActivity(
  db: OperationsDatabase,
  input: {
    now: number;
    outcome: ActivityOutcome | null;
    cursor: { createdAt: number; id: string } | null;
    limit: number;
  },
): Promise<ActivityResponse> {
  const window = [windowStart(input.now), input.now];
  const countRows = await db
    .prepare(`${ACTIVITY_CTE} SELECT outcome, COUNT(*) AS n FROM activity GROUP BY outcome`)
    .bind(...window)
    .all<{ outcome: ActivityOutcome; n: number }>();
  const counts = Object.fromEntries(ACTIVITY_OUTCOMES.map((outcome) => [outcome, 0])) as Record<
    ActivityOutcome,
    number
  >;
  for (const row of countRows.results) {
    counts[row.outcome] = row.n;
  }

  const filters: string[] = [];
  const params: unknown[] = [...window];
  if (input.outcome) {
    filters.push("outcome = ?");
    params.push(input.outcome);
  }
  if (input.cursor) {
    filters.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(input.cursor.createdAt, input.cursor.createdAt, input.cursor.id);
  }
  params.push(input.limit + 1);
  const { results } = await db
    .prepare(
      `${ACTIVITY_CTE}
       SELECT id, created_at, latency_ms, person, question, sources, outcome FROM activity
       ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...params)
    .all<ActivitySqlRow>();
  const page = results.slice(0, input.limit);
  const rows: ActivityRow[] = page.map((row) => ({
    messageId: row.id,
    createdAt: row.created_at,
    person: row.person,
    question: row.question.slice(0, MAX_QUESTION_CHARS),
    outcome: row.outcome,
    sources: row.sources,
    latencyMs: row.latency_ms,
  }));
  return {
    range: "7d",
    total: ACTIVITY_OUTCOMES.reduce((sum, outcome) => sum + counts[outcome], 0),
    counts,
    rows,
    nextCursor:
      results.length > input.limit ? encodeActivityCursor(page[page.length - 1]) : null,
  };
}

export async function assistantMessageExists(
  db: OperationsDatabase,
  messageId: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS present FROM messages WHERE id = ? AND role = 'assistant'`)
    .bind(messageId)
    .first<{ present: number }>();
  return row !== null;
}
