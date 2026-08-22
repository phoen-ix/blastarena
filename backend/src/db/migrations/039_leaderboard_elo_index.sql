-- Index the public leaderboard sort.
-- GET /api/leaderboard is unauthenticated and orders by user_stats.elo_rating with no index on
-- that column, so every page scanned all of user_stats, joined users and filesorted. season_elo
-- already has idx_season_elo_ranking for this, but the no-active-season path had nothing.
-- (audit LEADERBOARD-INDEX-1)
ALTER TABLE user_stats ADD INDEX idx_user_stats_elo (elo_rating);

-- Index the match-history sort.
-- Match history and the admin match list both order by matches.finished_at, which 001 left
-- unindexed -- it indexes status, game_mode and created_at only.
ALTER TABLE matches ADD INDEX idx_matches_finished_at (finished_at);
