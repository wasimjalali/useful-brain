-- Operations D1: identity directory. Conversations and runs land in later phases.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE principals (
  subject TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'service_token')),
  user_id TEXT REFERENCES users (id),
  created_at INTEGER NOT NULL
);

CREATE TABLE roles (
  user_id TEXT NOT NULL REFERENCES users (id),
  role TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE departments (
  user_id TEXT NOT NULL REFERENCES users (id),
  department TEXT NOT NULL,
  PRIMARY KEY (user_id, department)
);
