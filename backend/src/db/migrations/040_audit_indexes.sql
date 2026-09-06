-- Indexes for live queries that had none, plus one redundant index dropped. (audit E9)

-- GET /admin/actions?action=… filters on action and sorts by created_at; only created_at was
-- indexed, so a filtered page scanned every row of that action.
CREATE INDEX idx_admin_actions_action ON admin_actions(action, created_at);

-- Incoming friend requests: WHERE friend_id = ? AND status = 'pending'. Only (friend_id) alone
-- was indexed, so status was filtered row by row.
CREATE INDEX idx_friendships_friend_status ON friendships(friend_id, status);

-- checkCampaignStarUnlocks / level-up unlocks: WHERE unlock_type = ? AND is_active = TRUE, run on
-- every campaign completion and level-up.
CREATE INDEX idx_cosmetics_unlock ON cosmetics(unlock_type, is_active);

-- evaluateAfterGame / evaluateAfterCampaign: WHERE is_active = TRUE AND condition_type (!)= …
CREATE INDEX idx_achievements_active ON achievements(is_active, condition_type);

-- Admin campaign-replay list: ORDER BY created_at DESC.
CREATE INDEX idx_campaign_replays_created ON campaign_replays(created_at);

-- listMyMaps: ORDER BY updated_at DESC.
CREATE INDEX idx_custom_maps_updated ON custom_maps(updated_at);

-- Refresh-token reaper (audit E8): DELETE … WHERE revoked = TRUE AND created_at < … in chunks.
-- The expired-token half already uses idx_refresh_tokens_expires from 001.
CREATE INDEX idx_refresh_tokens_revoked_created ON refresh_tokens(revoked, created_at);

-- idx_progress_user_level (021) duplicated uk_user_level (008) — same columns, same order.
DROP INDEX idx_progress_user_level ON campaign_progress;
