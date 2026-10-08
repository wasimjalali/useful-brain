-- Uploads and the draft pipeline. Additive. Nothing here touches the active
-- generation: a draft is an ordinary corpus generation plus the rows below.

-- At most one open draft. `slot` is constant, so the partial unique index
-- makes a second concurrent draft impossible instead of merely unlikely.
CREATE TABLE drafts (
  generation_id TEXT PRIMARY KEY REFERENCES corpus_generations (id),
  slot INTEGER NOT NULL DEFAULT 1 CHECK (slot = 1),
  kind TEXT NOT NULL CHECK (kind IN ('upload', 'reindex')),
  base_generation_id TEXT,
  created_by TEXT NOT NULL,
  base_copied_at INTEGER,
  -- Durable enqueue intent: NULL until the draft job reached the queue. A crash
  -- between the database write and the publish leaves it NULL and the next
  -- request for this draft publishes it again.
  job_enqueued_at INTEGER,
  -- The workflow instance that won the finalization claim. The same instance
  -- may resume a claim whose result it never saw; any other instance is refused.
  finalize_owner TEXT,
  closed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_drafts_open ON drafts (slot) WHERE closed_at IS NULL;

CREATE TABLE upload_batches (
  id TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL REFERENCES corpus_generations (id),
  created_by TEXT NOT NULL,
  access_scope TEXT NOT NULL CHECK (access_scope IN ('public', 'department', 'role')),
  allowed_roles TEXT NOT NULL DEFAULT '[]',
  allowed_departments TEXT NOT NULL DEFAULT '[]',
  idempotency_key TEXT NOT NULL UNIQUE,
  -- Same intent marker for the batch's delivery-expiry job.
  job_enqueued_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE upload_files (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES upload_batches (id),
  file_name TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  document_id TEXT NOT NULL,
  r2_key TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('parsing', 'chunking', 'embedding', 'ready', 'failed')),
  error_code TEXT,
  chunks_total INTEGER,
  chunks_embedded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_upload_files_batch ON upload_files (batch_id);

CREATE TABLE draft_checks (
  generation_id TEXT PRIMARY KEY REFERENCES corpus_generations (id),
  status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'paused')),
  reconciled INTEGER NOT NULL DEFAULT 0 CHECK (reconciled IN (0, 1)),
  -- 'ledger_getbyids' = every ledger vector fetched from the index; 'keyword_only' = no index bound.
  reconcile_mode TEXT CHECK (reconcile_mode IN ('ledger_getbyids', 'keyword_only')),
  acl_leaks INTEGER,
  live_recall REAL,
  questions_run INTEGER,
  error_code TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX idx_draft_checks_started ON draft_checks (started_at);
