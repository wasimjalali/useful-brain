-- Approval card display copy and the tickets created by approved create_ticket calls.
ALTER TABLE approvals ADD COLUMN display_arguments_json TEXT;

CREATE TABLE tickets (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  -- No foreign key: a ticket is a durable record of an external action and
  -- outlives the chat run (and the conversation) that proposed it.
  run_id TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES principals (id),
  desk TEXT NOT NULL CHECK (desk IN ('Support')),
  priority TEXT NOT NULL CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  customer TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_tickets_run ON tickets (run_id);

-- The first ticket is SUP-4800.
INSERT INTO sqlite_sequence (name, seq) VALUES ('tickets', 4799);
