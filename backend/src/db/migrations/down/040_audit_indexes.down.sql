CREATE INDEX idx_progress_user_level ON campaign_progress(user_id, level_id);
DROP INDEX idx_refresh_tokens_revoked_created ON refresh_tokens;
DROP INDEX idx_custom_maps_updated ON custom_maps;
DROP INDEX idx_campaign_replays_created ON campaign_replays;
DROP INDEX idx_achievements_active ON achievements;
DROP INDEX idx_cosmetics_unlock ON cosmetics;
DROP INDEX idx_friendships_friend_status ON friendships;
DROP INDEX idx_admin_actions_action ON admin_actions;
