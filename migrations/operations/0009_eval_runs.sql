-- Evaluation runs for the Cloudflare UI path. Staging applied 0008; this file is additive.
CREATE TABLE eval_runs (
  id TEXT PRIMARY KEY,
  owner_principal_id TEXT NOT NULL REFERENCES principals (id),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'interrupted')),
  total INTEGER NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  results_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX eval_runs_by_owner_started
  ON eval_runs (owner_principal_id, started_at);
