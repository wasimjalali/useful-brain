-- Corpus lifecycle: sources, documents, chunks, reconciliation.
-- FTS5 external-content tables remain Phase 3.
-- 0001_init.sql is already applied on staging, so failed is added here.

CREATE TABLE corpus_generations_new (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (
    state IN ('draft', 'indexing', 'reconciling', 'ready', 'active', 'archived', 'failed')
  ),
  chunking_version TEXT NOT NULL DEFAULT '300-30-v1',
  embedding_model TEXT NOT NULL DEFAULT '@cf/qwen/qwen3-embedding-0.6b',
  embedding_dimensions INTEGER NOT NULL DEFAULT 1024,
  metadata_index_ready INTEGER NOT NULL DEFAULT 0 CHECK (metadata_index_ready IN (0, 1)),
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO corpus_generations_new (id, state, created_at, updated_at)
SELECT id, state, created_at, created_at FROM corpus_generations;

DROP TABLE corpus_generations;
ALTER TABLE corpus_generations_new RENAME TO corpus_generations;

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('upload', 'github', 'http')),
  display_name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources (id),
  path TEXT NOT NULL,
  access_scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (source_id, path)
);

CREATE TABLE document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents (id),
  generation_id TEXT NOT NULL REFERENCES corpus_generations (id),
  r2_key TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (document_id, generation_id)
);

CREATE TABLE chunks (
  chunk_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  heading TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  content_digest TEXT NOT NULL,
  vector_id TEXT NOT NULL,
  acl_group TEXT NOT NULL CHECK (length(acl_group) = 32),
  created_at INTEGER NOT NULL,
  UNIQUE (vector_id)
);

CREATE INDEX idx_chunks_generation ON chunks (generation_id);
CREATE INDEX idx_chunks_document ON chunks (document_id);

CREATE TABLE vector_mutations (
  generation_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (generation_id, mutation_id)
);

CREATE TABLE reconciliation_audits (
  id TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'unsupported')),
  missing_count INTEGER NOT NULL,
  orphan_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
