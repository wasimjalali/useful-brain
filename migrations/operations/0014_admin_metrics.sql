-- Operations D1: per-turn trace steps and service health events.
-- Additive only. Step details carry ids, counts, scores and model names, never evidence text.
-- Activity and the conversation view look a run up by the message it answered.
CREATE INDEX agent_runs_by_evidence_message ON agent_runs (evidence_message_id);

CREATE TABLE turn_steps (
  message_id TEXT NOT NULL REFERENCES messages (id),
  seq INTEGER NOT NULL,
  step TEXT NOT NULL CHECK (
    step IN ('rewrite', 'retrieve', 'rerank', 'generate', 'tool_call', 'approval', 'result')
  ),
  detail_json TEXT NOT NULL,
  duration_ms INTEGER,
  PRIMARY KEY (message_id, seq)
);

CREATE TABLE service_health_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'error')),
  code TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX service_health_events_by_service_at
  ON service_health_events (service, at);
