-- Operations D1: per-turn metrics, message feedback and document requests.
-- Additive only. A document request from the Library has no message (message_id NULL). Metrics columns stay out of the turn completion digest.
ALTER TABLE messages ADD COLUMN latency_ms INTEGER;
ALTER TABLE messages ADD COLUMN passages_retrieved INTEGER;
ALTER TABLE messages ADD COLUMN best_candidate_department TEXT;

CREATE INDEX messages_by_type_created
  ON messages (role, status, answer_type, created_at);

CREATE TABLE message_feedback (
  message_id TEXT NOT NULL REFERENCES messages (id),
  principal_id TEXT NOT NULL REFERENCES principals (id),
  value TEXT NOT NULL CHECK (value IN ('up', 'down')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, principal_id)
);

CREATE TABLE document_requests (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals (id),
  message_id TEXT REFERENCES messages (id),
  question_normalized TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (principal_id, question_normalized)
);

CREATE INDEX document_requests_by_question
  ON document_requests (question_normalized);
