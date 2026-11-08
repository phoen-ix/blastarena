-- Who won, per player and match. "Wins" used to be read as placement = 1, which is wrong both
-- ways: teams mode ranks every member of the winning team, and players who die in the same tick
-- share a placement, so a draw can leave several players on placement 1 with nobody winning.
-- GameRoom writes the real flag from now on.
ALTER TABLE match_players ADD COLUMN IF NOT EXISTS is_winner BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill, as well as the stored data allows (repeat-safe: it only ever sets TRUE).
-- 1. matches.winner_id names the winner whenever a human won a non-team match.
UPDATE match_players mp
JOIN matches m ON m.id = mp.match_id
SET mp.is_winner = TRUE
WHERE m.winner_id = mp.user_id;

-- 2. Teams mode records no winner (winner_id stays NULL, the winning team is not stored), but
--    every surviving member of the winning team gets placement 1. Approximation: a teams draw in
--    which the last players died in the same tick also left placement 1 behind, and such rows
--    count as wins here. Teams matches from before placements were set for the winners (NULL
--    placement) stay FALSE. Non-team matches without winner_id were won by a bot or drawn: FALSE.
UPDATE match_players mp
JOIN matches m ON m.id = mp.match_id
SET mp.is_winner = TRUE
WHERE m.game_mode = 'teams' AND m.winner_id IS NULL AND mp.placement = 1;

-- "Pacifist Win" (self_kills == 0) and "Speed Demon" (survived_seconds <= 60), seeded by 017, are
-- about winning, but per_game conditions tested the stat alone, so they unlocked on losses.
-- `requireWin` makes only a won game count. JSON_EXTRACT('true', '$') is the JSON literal true
-- (a bare TRUE would be stored as 1). Matched on name and stat, so a renamed or repurposed row is
-- left alone; JSON_SET is repeat-safe.
UPDATE achievements
SET condition_config = JSON_SET(condition_config, '$.requireWin', JSON_EXTRACT('true', '$'))
WHERE condition_type = 'per_game'
  AND (
    (name = 'Pacifist Win' AND JSON_UNQUOTE(JSON_EXTRACT(condition_config, '$.stat')) = 'self_kills')
    OR (name = 'Speed Demon' AND JSON_UNQUOTE(JSON_EXTRACT(condition_config, '$.stat')) = 'survived_seconds')
  );
