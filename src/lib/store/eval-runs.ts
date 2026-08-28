import type { EvalCaseResult, EvalRunResult } from "../eval/manual-eval-set";
import { newBoundedId, type OperationsDatabase } from "./conversations";

type EvalRunRow = {
  id: string;
  status: string;
  total: number;
  passed: number;
  started_at: number;
  finished_at: number | null;
  results_json: string;
};

export async function startEvalRun(
  db: OperationsDatabase,
  input: { ownerPrincipalId: string; total: number; now: number },
): Promise<string> {
  const id = newBoundedId("eval");
  await db
    .prepare(
      `INSERT INTO eval_runs (
         id, owner_principal_id, status, total, passed, started_at, finished_at, results_json
       ) VALUES (?, ?, 'running', ?, 0, ?, NULL, '[]')`,
    )
    .bind(id, input.ownerPrincipalId, input.total, input.now)
    .run();
  return id;
}

export async function finishEvalRun(
  db: OperationsDatabase,
  input: {
    runId: string;
    ownerPrincipalId: string;
    status: "completed" | "interrupted";
    passed: number;
    results: EvalCaseResult[];
    now: number;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE eval_runs
       SET status = ?, passed = ?, finished_at = ?, results_json = ?
       WHERE id = ? AND owner_principal_id = ? AND status = 'running'`,
    )
    .bind(
      input.status,
      input.passed,
      input.now,
      JSON.stringify(input.results),
      input.runId,
      input.ownerPrincipalId,
    )
    .run();
}

export async function listRecentEvalRuns(
  db: OperationsDatabase,
  ownerPrincipalId: string,
  limit = 20,
): Promise<EvalRunResult[]> {
  const rows = await db
    .prepare(
      `SELECT id, status, total, passed, started_at, finished_at, results_json
       FROM eval_runs
       WHERE owner_principal_id = ? AND status = 'completed'
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .bind(ownerPrincipalId, limit)
    .all<EvalRunRow>();
  return rows.results.map((row) => {
    let results: EvalCaseResult[] = [];
    try {
      const parsed: unknown = JSON.parse(row.results_json);
      if (Array.isArray(parsed)) {
        results = parsed as EvalCaseResult[];
      }
    } catch {
      results = [];
    }
    return {
      ranAt: new Date(row.finished_at ?? row.started_at).toISOString(),
      total: row.total,
      passed: row.passed,
      results,
    };
  });
}
