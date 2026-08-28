-- Exact tool replay, approval/run linkage and durable mutating effects.
ALTER TABLE tool_calls ADD COLUMN normalized_arguments_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE approvals ADD COLUMN run_id TEXT REFERENCES agent_runs (id);

CREATE UNIQUE INDEX approvals_by_run
  ON approvals (run_id)
  WHERE run_id IS NOT NULL;

CREATE TABLE idempotent_effects (
  idempotency_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
  result_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE synthetic_mutating_effects (
  idempotency_key TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  normalized_arguments_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
