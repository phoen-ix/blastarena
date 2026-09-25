-- Structure only: the plaintext emails 030 dropped cannot be restored (the runner refuses this
-- rollback without `force`). The index and NOT NULL are undone too, so 030 can be applied again.
ALTER TABLE users
  DROP INDEX IF EXISTS idx_users_email_hash,
  MODIFY COLUMN email_hash VARCHAR(64) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT NULL AFTER username,
  ADD COLUMN IF NOT EXISTS pending_email VARCHAR(255) DEFAULT NULL AFTER email_verify_token;
