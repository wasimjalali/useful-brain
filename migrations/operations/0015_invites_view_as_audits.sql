-- Operations D1: admin-issued single-use invites and the view-as audit trail.
-- Additive. SQLite foreign keys require PRAGMA foreign_keys = ON on the connection.
-- Only the sha256 of an invite token is stored; the token is shown once.
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  department TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  created_by TEXT NOT NULL REFERENCES principals (id),
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX invites_open_email ON invites (email) WHERE accepted_at IS NULL;

CREATE TABLE view_as_audits (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  admin_principal_id TEXT NOT NULL REFERENCES principals (id),
  assumed_principal_id TEXT NOT NULL REFERENCES principals (id),
  question_sha256 TEXT NOT NULL,
  answer_type TEXT,
  cited_document_ids_json TEXT,
  diagnostic_shown INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
