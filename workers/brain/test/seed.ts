import { env } from "cloudflare:workers";

export async function seedPrincipals(): Promise<void> {
  await env.OPERATIONS_DB.batch([
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO principals (id, kind, subject, created_at) VALUES (?, ?, ?, ?)`,
    ).bind("principal-alice", "user", "alice@karkoai.com", 1),
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO roles (principal_id, role) VALUES (?, ?)`,
    ).bind("principal-alice", "operator"),
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO departments (principal_id, department) VALUES (?, ?)`,
    ).bind("principal-alice", "engineering"),
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO principals (id, kind, subject, created_at) VALUES (?, ?, ?, ?)`,
    ).bind("principal-dev", "user", "dev@localhost", 1),
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO roles (principal_id, role) VALUES (?, ?)`,
    ).bind("principal-dev", "operator"),
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO principals (id, kind, subject, created_at) VALUES (?, ?, ?, ?)`,
    ).bind("principal-bot", "service_token", "ci-bot.access", 1),
    env.OPERATIONS_DB.prepare(
      `INSERT OR IGNORE INTO roles (principal_id, role) VALUES (?, ?)`,
    ).bind("principal-bot", "ingest"),
  ]);
}
