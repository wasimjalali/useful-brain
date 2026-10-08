-- Full Vectorize inventory in draft reconciliation. Additive. `reconcile_mode`
-- and its CHECK are untouched: the mode still names how ledger vectors were
-- verified, these columns record the extra listing.
-- inventory_checked: 1 when the index was listed and compared with D1, 0 when
-- the check ran binding-only (no inventory secrets, or the listing failed).
-- NULL means the row predates this migration, or the check has not finished.
-- orphan_vectors: listed ids no D1 row accounts for that still exist in the index
-- (above the unknown-id cap, the count of unknown ids, unresolved).
-- orphan_vectors_in_draft: the subset in the draft's own namespace. Any of
-- those blocks the draft; orphans elsewhere cannot reach its queries. NULL
-- whenever inventory_checked is not 1, and when the cap was exceeded.
ALTER TABLE draft_checks ADD COLUMN inventory_checked INTEGER CHECK (inventory_checked IN (0, 1));
ALTER TABLE draft_checks ADD COLUMN orphan_vectors INTEGER;
ALTER TABLE draft_checks ADD COLUMN orphan_vectors_in_draft INTEGER;
