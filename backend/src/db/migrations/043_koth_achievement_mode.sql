-- The seeded "Hill Holder" achievement matched mode 'koth', but matches record the mode as
-- 'king_of_the_hill', so it could never be earned.
UPDATE achievements
SET condition_config = JSON_SET(condition_config, '$.mode', 'king_of_the_hill')
WHERE condition_type = 'mode_specific'
  AND JSON_UNQUOTE(JSON_EXTRACT(condition_config, '$.mode')) = 'koth';
