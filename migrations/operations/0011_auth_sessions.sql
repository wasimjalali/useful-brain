-- Operations D1: email/password accounts and hashed session tokens.
-- Staging has already applied 0010_evidence_scores.sql; this file is additive.
-- SQLite foreign keys require PRAGMA foreign_keys = ON on the connection.
CREATE TABLE auth_users (
  id TEXT PRIMARY KEY REFERENCES principals (id),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX auth_sessions_user ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expires ON auth_sessions (expires_at);

CREATE TABLE auth_login_attempts (
  email TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX auth_login_attempts_email_time
  ON auth_login_attempts (email, attempted_at);
