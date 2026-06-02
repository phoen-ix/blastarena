ALTER TABLE users
  ADD COLUMN email_verify_expires TIMESTAMP NULL DEFAULT NULL AFTER email_verify_token;
