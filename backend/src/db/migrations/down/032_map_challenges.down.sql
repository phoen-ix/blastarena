-- Settings first: the DDL below commits implicitly, so a failing statement after it left the
-- schema half-reverted while the migration still counted as applied. (It also named a
-- `settings` table that does not exist; the table is server_settings.)
DELETE FROM server_settings WHERE setting_key = 'challenges_enabled';
DROP TABLE IF EXISTS challenge_scores;
DROP TABLE IF EXISTS map_challenges;
ALTER TABLE matches DROP INDEX idx_matches_custom_map;
ALTER TABLE matches DROP COLUMN custom_map_id;
