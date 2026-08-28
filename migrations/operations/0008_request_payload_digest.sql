-- Bind request-ID claims to the question so concurrent retries with a
-- different payload cannot persist the loser's question on the winner.
ALTER TABLE request_id_claims ADD COLUMN payload_digest TEXT;
