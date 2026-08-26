-- Operations D1: identity directory.
-- No remote D1 has applied this migration. RESOURCES_PROVISIONED remains false,
-- so this initial file may still be corrected rather than adding 0002_*.sql.
-- Conversations and runs land in later phases.
-- SQLite foreign keys are enforced only when a connection sets
-- PRAGMA foreign_keys = ON. Tests enable that pragma; Brain must too
-- before mutating principal or grant rows.
CREATE TABLE principals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'service_token')),
  subject TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, subject),
  CHECK (
    (kind = 'user' AND instr(subject, '@') > 0)
    OR (kind = 'service_token' AND instr(subject, '@') = 0)
  )
);

CREATE TABLE roles (
  principal_id TEXT NOT NULL REFERENCES principals (id),
  role TEXT NOT NULL,
  PRIMARY KEY (principal_id, role)
);

CREATE TABLE departments (
  principal_id TEXT NOT NULL REFERENCES principals (id),
  department TEXT NOT NULL,
  PRIMARY KEY (principal_id, department)
);
