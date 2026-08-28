-- Bind a completed assistant message and its immutable evidence snapshot to one writer.
ALTER TABLE messages ADD COLUMN completion_token TEXT;

CREATE UNIQUE INDEX messages_by_completion_token
  ON messages (completion_token)
  WHERE completion_token IS NOT NULL;

CREATE TABLE turn_completion_claims (
  message_id TEXT PRIMARY KEY REFERENCES messages (id),
  completion_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
