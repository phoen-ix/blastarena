UPDATE achievements
SET condition_config = JSON_REMOVE(condition_config, '$.requireWin')
WHERE condition_type = 'per_game'
  AND name IN ('Pacifist Win', 'Speed Demon')
  AND JSON_EXTRACT(condition_config, '$.requireWin') IS NOT NULL;

ALTER TABLE match_players DROP COLUMN IF EXISTS is_winner;
