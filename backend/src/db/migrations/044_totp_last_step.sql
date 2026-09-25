-- Last accepted TOTP time step per account.
-- IF NOT EXISTS: the ALTER commits on its own, before the runner records the migration, so a run
-- interrupted in between must be able to run again.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NULL;
