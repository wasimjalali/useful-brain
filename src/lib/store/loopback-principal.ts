import type { OperationsDatabase } from "./conversations";

export const LOOPBACK_PRINCIPAL_ID = "principal-dev";

export const LOOPBACK_ROLES = ["operator", "standard"] as const;

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
