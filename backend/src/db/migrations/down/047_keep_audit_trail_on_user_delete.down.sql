-- Restores the 001/002/032 definitions: NOT NULL, ON DELETE CASCADE. Rows whose author was
-- deleted cannot satisfy NOT NULL, and the old schema would have deleted them with the account, so
-- they are deleted here.
ALTER TABLE admin_actions DROP FOREIGN KEY IF EXISTS fk_admin_actions_admin;
DELETE FROM admin_actions WHERE admin_id IS NULL;
ALTER TABLE admin_actions MODIFY COLUMN admin_id INT NOT NULL;
ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_ibfk_1 FOREIGN KEY IF NOT EXISTS (admin_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE announcements DROP FOREIGN KEY IF EXISTS fk_announcements_admin;
DELETE FROM announcements WHERE admin_id IS NULL;
ALTER TABLE announcements MODIFY COLUMN admin_id INT NOT NULL;
ALTER TABLE announcements ADD CONSTRAINT announcements_ibfk_1 FOREIGN KEY IF NOT EXISTS (admin_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE map_challenges DROP FOREIGN KEY IF EXISTS fk_map_challenges_created_by;
DELETE FROM map_challenges WHERE created_by IS NULL;
ALTER TABLE map_challenges MODIFY COLUMN created_by INT NOT NULL;
ALTER TABLE map_challenges ADD CONSTRAINT map_challenges_ibfk_2 FOREIGN KEY IF NOT EXISTS (created_by) REFERENCES users(id) ON DELETE CASCADE;
