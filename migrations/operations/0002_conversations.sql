-- Operations D1: conversations, messages and immutable evidence snapshots.
-- Staging has already applied 0001_init.sql; this file is additive.
-- SQLite foreign keys require PRAGMA foreign_keys = ON on the connection.
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  owner_principal_id TEXT NOT NULL REFERENCES principals (id),
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX conversations_by_owner_updated
  ON conversations (owner_principal_id, updated_at);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id),
  request_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  answer_type TEXT CHECK (
    answer_type IN (
      'grounded',
      'insufficient_evidence',
      'unavailable',
      'must_retrieve',
      'invalid_citation'
    )
  ),
  answer_model TEXT,
  embedding_model TEXT,
  embedding_dimensions INTEGER,
  structured_paragraphs_json TEXT,
  prompt_version TEXT,
  retrieval_config_version TEXT,
  corpus_generation_id TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX messages_by_conversation_created
  ON messages (conversation_id, created_at);

CREATE UNIQUE INDEX messages_by_request_id
  ON messages (request_id)
  WHERE request_id IS NOT NULL;

CREATE TABLE evidence_snapshots (
  message_id TEXT NOT NULL REFERENCES messages (id),
  rank INTEGER NOT NULL,
  score REAL NOT NULL,
  chunk_id TEXT NOT NULL,
  source TEXT NOT NULL,
  section TEXT NOT NULL,
  text TEXT NOT NULL,
  token_estimate INTEGER NOT NULL,
  citation_label TEXT NOT NULL,
  document_id TEXT,
  generation_id TEXT,
  PRIMARY KEY (message_id, rank)
);
