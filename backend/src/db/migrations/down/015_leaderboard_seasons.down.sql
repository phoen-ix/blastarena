DELETE FROM server_settings WHERE setting_key = 'rank_tiers';
ALTER TABLE user_stats DROP COLUMN peak_elo;
ALTER TABLE users DROP COLUMN accept_friend_requests;
ALTER TABLE users DROP COLUMN is_profile_public;
DROP TABLE IF EXISTS elo_history;
DROP TABLE IF EXISTS season_elo;
DROP TABLE IF EXISTS seasons;
