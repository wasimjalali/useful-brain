-- Operations D1: agent runs, tool calls and approval records.
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id),
  principal_id TEXT NOT NULL REFERENCES principals (id),
  status TEXT NOT NULL CHECK (
    status IN ('running', 'completed', 'failed', 'cancelled', 'pending_approval')
  ),
  model TEXT,
  prompt_version TEXT,
  corpus_generation_id TEXT,
  evidence_message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX agent_runs_by_conversation ON agent_runs (conversation_id, created_at);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs (id),
  tool TEXT NOT NULL,
  argument_fingerprint TEXT NOT NULL,
  redacted_result TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'denied', 'pending_approval')),
  created_at INTEGER NOT NULL
);

CREATE TABLE approvals (
  idempotency_key TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  argument_fingerprint TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_at INTEGER NOT NULL
);
