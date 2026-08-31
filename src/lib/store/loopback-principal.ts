import type { OperationsDatabase } from "./conversations";

export const LOOPBACK_PRINCIPAL_ID = "principal-dev";

/**
 * Explicit operator-read policy for the local single-operator deployment:
 * the loopback operator loaded every document in the corpus, so it holds
 * every role-gating role the synthetic corpus uses. This list is declared,
 * not inferred, and applies only in loopback identity mode; startup forbids
 * loopback on staging and workers.dev. Private-owner documents stay closed
 * because ownership, not roles, gates them.
 */
export const LOOPBACK_ROLES = [
  "operator",
  "standard",
  "manager",
  "hr_manager",
  "finance_manager",
  "sales_manager",
  "support_manager",
  "director",
  "it_admin",
] as const;

export const LOOPBACK_DEPARTMENTS = [
  "engineering",
  "hr",
  "finance",
  "sales",
  "support",
  "operations",
  "legal",
  "executive",
] as const;

export async function ensureLoopbackPrincipal(
  db: OperationsDatabase,
  subject: string,
  now = Date.now(),
): Promise<{ id: string; subject: string }> {
  const normalized = subject.trim().toLowerCase();
  if (!normalized.includes("@")) {
    throw new Error("loopback subject must occupy the email namespace");
  }
  await db.prepare("PRAGMA foreign_keys = ON").run();
  await db
    .prepare(
      `INSERT INTO principals (id, kind, subject, created_at)
       VALUES (?, 'user', ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(LOOPBACK_PRINCIPAL_ID, normalized, now)
    .run();
  for (const role of LOOPBACK_ROLES) {
    await db
      .prepare(`INSERT INTO roles (principal_id, role) VALUES (?, ?) ON CONFLICT(principal_id, role) DO NOTHING`)
      .bind(LOOPBACK_PRINCIPAL_ID, role)
      .run();
  }
  for (const department of LOOPBACK_DEPARTMENTS) {
    await db
      .prepare(
        `INSERT INTO departments (principal_id, department) VALUES (?, ?)
         ON CONFLICT(principal_id, department) DO NOTHING`,
      )
      .bind(LOOPBACK_PRINCIPAL_ID, department)
      .run();
  }
  return { id: LOOPBACK_PRINCIPAL_ID, subject: normalized };
}
