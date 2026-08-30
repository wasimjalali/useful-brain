ALTER TABLE evidence_snapshots ADD COLUMN vector_score REAL;
ALTER TABLE evidence_snapshots ADD COLUMN keyword_score REAL;
ALTER TABLE evidence_snapshots ADD COLUMN fused_score REAL;
ALTER TABLE evidence_snapshots ADD COLUMN rerank_score REAL;
