-- Full Vectorize inventory in draft reconciliation. Additive. Columns stay
-- NULL for checks that ran binding-only (no inventory token) or before this
-- migration. `reconcile_mode` and its CHECK are untouched: the mode still names
-- how ledger vectors were verified, these columns record the extra listing.
-- inventory_checked: 1 when the index was listed and compared with D1.
-- orphan_vectors: listed ids no D1 row accounts for that still exist in the index.
-- orphan_vectors_in_draft: the subset in the draft's own namespace. Any of
-- those blocks the draft; orphans elsewhere cannot reach its queries.
ALTER TABLE draft_checks ADD COLUMN inventory_checked INTEGER CHECK (inventory_checked IN (0, 1));
ALTER TABLE draft_checks ADD COLUMN orphan_vectors INTEGER;
ALTER TABLE draft_checks ADD COLUMN orphan_vectors_in_draft INTEGER;
