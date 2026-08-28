-- External-content FTS5. Rebuild chunks so the FTS rowid is a stable
-- INTEGER PRIMARY KEY AUTOINCREMENT. Do not use the replace-insert form.

-- The Phase 2 chunks table did not carry the ACL fields needed by Phase 3.
-- Refuse to guess those grants if this migration is ever applied after ingest.
CREATE TABLE migration_0003_guard (
  legacy_chunk_count INTEGER NOT NULL CHECK (legacy_chunk_count = 0)
);
INSERT INTO migration_0003_guard (legacy_chunk_count) SELECT COUNT(*) FROM chunks;
DROP TABLE migration_0003_guard;

CREATE TABLE chunks_fts_ready (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id TEXT NOT NULL UNIQUE,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  heading TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  content_digest TEXT NOT NULL,
  vector_id TEXT NOT NULL UNIQUE,
  acl_group TEXT NOT NULL CHECK (length(acl_group) = 32),
  access_scope TEXT NOT NULL,
  allowed_roles TEXT NOT NULL DEFAULT '[]',
  allowed_departments TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

DROP TABLE chunks;
ALTER TABLE chunks_fts_ready RENAME TO chunks;

CREATE INDEX idx_chunks_generation ON chunks (generation_id);
CREATE INDEX idx_chunks_document ON chunks (document_id);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content,
  content='chunks',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
END;

INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild');
