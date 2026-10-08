import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Vite does not resolve the node:sqlite builtin through import; load it at run time.
type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): { all(): unknown[] };
};
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (location: string) => SqliteDatabase;
};

const ops = (name: string) =>
  readFileSync(path.join(process.cwd(), "migrations/operations", name), "utf8");

const PRIOR = [
  "0001_init.sql",
  "0002_conversations.sql",
  "0003_agent_runs.sql",
  "0004_idempotent_effects.sql",
  "0005_turn_completion_token.sql",
  "0006_request_id_claims.sql",
  "0007_parent_user_message.sql",
  "0008_request_payload_digest.sql",
  "0009_eval_runs.sql",
  "0010_evidence_scores.sql",
  "0011_auth_sessions.sql",
];

function dbWithPriorData(): SqliteDatabase {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of PRIOR) {
    db.exec(ops(file));
  }
  db.exec(`
    INSERT INTO principals (id, kind, subject, created_at) VALUES ('p1', 'user', 'a@x.example', 1);
    INSERT INTO conversations (id, owner_principal_id, title, created_at, updated_at) VALUES ('c1', 'p1', 't', 1, 1);
    INSERT INTO messages (id, conversation_id, role, content, status, answer_type, created_at, updated_at)
      VALUES ('m1', 'c1', 'user', 'q', 'completed', NULL, 1, 1),
             ('m2', 'c1', 'assistant', 'a', 'completed', 'grounded', 2, 2);
  `);
  return db;
}

describe("operations migration 0012", () => {
  it("applies additively over data from 0001-0011 and keeps every old row", () => {
    const db = dbWithPriorData();
    db.exec(ops("0012_turn_metrics_feedback.sql"));
    const rows = db
      .prepare(
        "SELECT id, content, answer_type, latency_ms, passages_retrieved, best_candidate_department FROM messages ORDER BY id",
      )
      .all();
    expect(rows).toEqual([
      { id: "m1", content: "q", answer_type: null, latency_ms: null, passages_retrieved: null, best_candidate_department: null },
      { id: "m2", content: "a", answer_type: "grounded", latency_ms: null, passages_retrieved: null, best_candidate_department: null },
    ]);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name IN ('message_feedback','document_requests','messages_by_type_created','document_requests_by_question') ORDER BY name").all(),
    ).toHaveLength(4);
  });

  it("rejects a feedback value outside up/down and a duplicate (message, principal)", () => {
    const db = dbWithPriorData();
    db.exec(ops("0012_turn_metrics_feedback.sql"));
    expect(() =>
      db.exec("INSERT INTO message_feedback (message_id, principal_id, value, created_at) VALUES ('m2','p1','sideways',1)"),
    ).toThrow();
    db.exec("INSERT INTO message_feedback (message_id, principal_id, value, created_at) VALUES ('m2','p1','up',1)");
    expect(() =>
      db.exec("INSERT INTO message_feedback (message_id, principal_id, value, created_at) VALUES ('m2','p1','down',2)"),
    ).toThrow();
  });

  it("enforces one request per (principal, normalized question) and real foreign keys", () => {
    const db = dbWithPriorData();
    db.exec(ops("0012_turn_metrics_feedback.sql"));
    db.exec("INSERT INTO document_requests (id, principal_id, message_id, question_normalized, created_at) VALUES ('r1','p1','m2','how long',1)");
    expect(() =>
      db.exec("INSERT INTO document_requests (id, principal_id, message_id, question_normalized, created_at) VALUES ('r2','p1','m2','how long',2)"),
    ).toThrow();
    expect(() =>
      db.exec("INSERT INTO document_requests (id, principal_id, message_id, question_normalized, created_at) VALUES ('r3','nobody','m2','other',2)"),
    ).toThrow();
  });

  it("allows a request with no message and still blocks a repeat of the same question", () => {
    const db = dbWithPriorData();
    db.exec(ops("0012_turn_metrics_feedback.sql"));
    db.exec("INSERT INTO document_requests (id, principal_id, message_id, question_normalized, created_at) VALUES ('r1','p1',NULL,'free text',1)");
    expect(() =>
      db.exec("INSERT INTO document_requests (id, principal_id, message_id, question_normalized, created_at) VALUES ('r2','p1',NULL,'free text',2)"),
    ).toThrow();
    expect(() =>
      db.exec("INSERT INTO document_requests (id, principal_id, message_id, question_normalized, created_at) VALUES ('r3','p1','nope','free text 2',2)"),
    ).toThrow();
  });
});
