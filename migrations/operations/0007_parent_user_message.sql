-- Pair assistant turns to their user question independently of created_at ties.
ALTER TABLE messages ADD COLUMN parent_user_message_id TEXT;

CREATE INDEX messages_by_parent_user
  ON messages (parent_user_message_id);
