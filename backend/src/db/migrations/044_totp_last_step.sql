-- Last accepted TOTP time step per account.
ALTER TABLE users ADD COLUMN totp_last_step BIGINT NULL;
