DROP TABLE IF EXISTS announcements;
ALTER TABLE matches MODIFY COLUMN game_mode ENUM('ffa', 'teams', 'battle_royale') NOT NULL;
ALTER TABLE users DROP COLUMN deactivated_at;
ALTER TABLE users DROP COLUMN is_deactivated;
