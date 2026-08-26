-- Corpus D1: generation pointer only. Chunk/FTS tables land in Phase 3.
CREATE TABLE corpus_generations (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (
    state IN ('draft', 'indexing', 'reconciling', 'ready', 'active', 'archived')
  ),
  created_at INTEGER NOT NULL
);

CREATE TABLE corpus_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  active_generation_id TEXT
);
