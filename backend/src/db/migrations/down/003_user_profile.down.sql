ALTER TABLE users DROP INDEX idx_users_email_change_token;
ALTER TABLE users DROP COLUMN email_change_expires;
ALTER TABLE users DROP COLUMN email_change_token;
ALTER TABLE users DROP COLUMN pending_email;
