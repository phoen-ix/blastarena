-- Deleting a staff account used to cascade into the audit log (admin_actions), the banner history
-- (announcements) and the map challenges it created, so removing an admin erased every trace of
-- what that admin did. The rows now stay, with the author set to NULL.
--
-- 001/002/032 declared these foreign keys without a name. MariaDB before 12.1 named them
-- <table>_ibfk_<n>, 12.1 and later just <n> (numbered per table in declaration order), so both
-- spellings are dropped (IF EXISTS skips the one this server does not have). The replacements get
-- explicit names. Every statement is guarded or repeat-safe: each ALTER commits on its own, so an
-- interrupted run must be able to run again.
ALTER TABLE admin_actions DROP FOREIGN KEY IF EXISTS admin_actions_ibfk_1;
ALTER TABLE admin_actions DROP FOREIGN KEY IF EXISTS `1`;
ALTER TABLE admin_actions MODIFY COLUMN admin_id INT NULL;
ALTER TABLE admin_actions ADD CONSTRAINT fk_admin_actions_admin FOREIGN KEY IF NOT EXISTS (admin_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE announcements DROP FOREIGN KEY IF EXISTS announcements_ibfk_1;
ALTER TABLE announcements DROP FOREIGN KEY IF EXISTS `1`;
ALTER TABLE announcements MODIFY COLUMN admin_id INT NULL;
ALTER TABLE announcements ADD CONSTRAINT fk_announcements_admin FOREIGN KEY IF NOT EXISTS (admin_id) REFERENCES users(id) ON DELETE SET NULL;

-- map_challenges' first foreign key (custom_map_id, ON DELETE CASCADE) stays as it is.
ALTER TABLE map_challenges DROP FOREIGN KEY IF EXISTS map_challenges_ibfk_2;
ALTER TABLE map_challenges DROP FOREIGN KEY IF EXISTS `2`;
ALTER TABLE map_challenges MODIFY COLUMN created_by INT NULL;
ALTER TABLE map_challenges ADD CONSTRAINT fk_map_challenges_created_by FOREIGN KEY IF NOT EXISTS (created_by) REFERENCES users(id) ON DELETE SET NULL;
