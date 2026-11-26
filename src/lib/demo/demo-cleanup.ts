import { DEMO_VISITOR_ID_PREFIX } from "../auth/session-account";
import type { OperationsDatabase } from "../store/conversations";

/** Visitors are removed one day after they arrive, with everything they made. */
export const DEMO_VISITOR_LIFETIME_MS = 24 * 60 * 60 * 1000;

const VISITORS = `SELECT id FROM principals WHERE id LIKE '${DEMO_VISITOR_ID_PREFIX}%' AND created_at < ?1`;
const CONVERSATIONS = `SELECT id FROM conversations WHERE owner_principal_id IN (${VISITORS})`;
const MESSAGES = `SELECT id FROM messages WHERE conversation_id IN (${CONVERSATIONS})`;
const RUNS = `SELECT id FROM agent_runs WHERE conversation_id IN (${CONVERSATIONS}) OR principal_id IN (${VISITORS})`;

/**
 * Children before parents, so every statement keeps the foreign keys valid.
 * Every operations table that points at a principal (directly or through a
 * conversation, message, run or account) is here; demo-cleanup.test.ts fails
 * when a migration adds one that is not.
 */
export const DEMO_CLEANUP_STATEMENTS: ReadonlyArray<{ table: string; sql: string }> = [
  { table: "evidence_snapshots", sql: `DELETE FROM evidence_snapshots WHERE message_id IN (${MESSAGES})` },
  { table: "turn_completion_claims", sql: `DELETE FROM turn_completion_claims WHERE message_id IN (${MESSAGES})` },
  { table: "turn_steps", sql: `DELETE FROM turn_steps WHERE message_id IN (${MESSAGES})` },
  {
    table: "message_feedback",
    sql: `DELETE FROM message_feedback WHERE message_id IN (${MESSAGES}) OR principal_id IN (${VISITORS})`,
  },
  {
    table: "document_requests",
    sql: `DELETE FROM document_requests WHERE message_id IN (${MESSAGES}) OR principal_id IN (${VISITORS})`,
  },
  { table: "tool_calls", sql: `DELETE FROM tool_calls WHERE run_id IN (${RUNS})` },
  {
    table: "approvals",
    sql: `DELETE FROM approvals WHERE run_id IN (${RUNS}) OR principal_id IN (${VISITORS}) OR conversation_id IN (${CONVERSATIONS})`,
  },
  { table: "agent_runs", sql: `DELETE FROM agent_runs WHERE id IN (${RUNS})` },
  { table: "messages", sql: `DELETE FROM messages WHERE id IN (${MESSAGES})` },
  { table: "conversations", sql: `DELETE FROM conversations WHERE id IN (${CONVERSATIONS})` },
  { table: "request_id_claims", sql: `DELETE FROM request_id_claims WHERE owner_principal_id IN (${VISITORS})` },
  { table: "eval_runs", sql: `DELETE FROM eval_runs WHERE owner_principal_id IN (${VISITORS})` },
  { table: "tickets", sql: `DELETE FROM tickets WHERE principal_id IN (${VISITORS})` },
  { table: "invites", sql: `DELETE FROM invites WHERE created_by IN (${VISITORS})` },
  {
    table: "view_as_audits",
    sql: `DELETE FROM view_as_audits WHERE admin_principal_id IN (${VISITORS}) OR assumed_principal_id IN (${VISITORS})`,
  },
  { table: "auth_sessions", sql: `DELETE FROM auth_sessions WHERE user_id IN (${VISITORS})` },
  { table: "auth_users", sql: `DELETE FROM auth_users WHERE id IN (${VISITORS})` },
  { table: "roles", sql: `DELETE FROM roles WHERE principal_id IN (${VISITORS})` },
  { table: "departments", sql: `DELETE FROM departments WHERE principal_id IN (${VISITORS})` },
  { table: "principals", sql: `DELETE FROM principals WHERE id IN (${VISITORS})` },
];

/** Removes demo visitors older than a day, in one transaction. Seeded people are never touched. */
export async function cleanupDemoVisitors(db: OperationsDatabase, now = Date.now()): Promise<void> {
  const cutoff = now - DEMO_VISITOR_LIFETIME_MS;
  await db.prepare("PRAGMA foreign_keys = ON").run();
  await db.batch(DEMO_CLEANUP_STATEMENTS.map(({ sql }) => db.prepare(sql).bind(cutoff)));
}
