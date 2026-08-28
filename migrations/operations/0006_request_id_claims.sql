-- Atomic first-turn request ID claims. Insert the claim before conversations
-- and messages so concurrent retries share one conversation.
CREATE TABLE request_id_claims (
  request_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT NOT NULL,
  owner_principal_id TEXT NOT NULL REFERENCES principals (id),
  created_at INTEGER NOT NULL
);

CREATE INDEX request_id_claims_by_conversation
  ON request_id_claims (conversation_id);
