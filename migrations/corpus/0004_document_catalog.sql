-- Document catalog: one row per document per generation, with the ACL columns
-- named exactly like chunks so aclSqlAndParams("c.") applies unchanged.
-- Additive. External-content FTS5 over title and headings keys on the
-- AUTOINCREMENT id. Do not use the replace-insert form on these tables.

CREATE TABLE document_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  title TEXT NOT NULL,
  department TEXT,
  version TEXT,
  effective_date TEXT,
  headings_json TEXT NOT NULL DEFAULT '[]',
  access_scope TEXT NOT NULL,
  allowed_roles TEXT NOT NULL DEFAULT '[]',
  allowed_departments TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  chunk_count INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (document_id, generation_id)
);

CREATE INDEX idx_document_catalog_generation ON document_catalog (generation_id);

CREATE TABLE document_bodies (
  document_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  body TEXT NOT NULL,
  reconstructed INTEGER NOT NULL DEFAULT 0 CHECK (reconstructed IN (0, 1)),
  PRIMARY KEY (document_id, generation_id)
);

CREATE VIRTUAL TABLE document_catalog_fts USING fts5(
  title,
  headings_json,
  content='document_catalog',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER document_catalog_ai AFTER INSERT ON document_catalog BEGIN
  INSERT INTO document_catalog_fts(rowid, title, headings_json)
  VALUES (new.id, new.title, new.headings_json);
END;
CREATE TRIGGER document_catalog_ad AFTER DELETE ON document_catalog BEGIN
  INSERT INTO document_catalog_fts(document_catalog_fts, rowid, title, headings_json)
  VALUES ('delete', old.id, old.title, old.headings_json);
END;
CREATE TRIGGER document_catalog_au AFTER UPDATE ON document_catalog BEGIN
  INSERT INTO document_catalog_fts(document_catalog_fts, rowid, title, headings_json)
  VALUES ('delete', old.id, old.title, old.headings_json);
  INSERT INTO document_catalog_fts(rowid, title, headings_json)
  VALUES (new.id, new.title, new.headings_json);
END;
