-- The public, unauthenticated /api/leaderboard orders by user_stats.elo_rating with no index on
-- that column, so every page request scanned all of user_stats, joined users and filesorted.
-- season_elo already got idx_season_elo_ranking for exactly this; the no-active-season path did
-- not. (audit LEADERBOARD-INDEX-1)
ALTER TABLE user_stats ADD INDEX idx_user_stats_elo (elo_rating);

-- Match history and the admin match list both sort by matches.finished_at, which 001 left
-- unindexed (it indexes status, game_mode and created_at only).
ALTER TABLE matches ADD INDEX idx_matches_finished_at (finished_at);
