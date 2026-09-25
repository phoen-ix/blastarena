UPDATE achievements
SET condition_config = JSON_SET(condition_config, '$.mode', 'koth')
WHERE condition_type = 'mode_specific'
  AND JSON_UNQUOTE(JSON_EXTRACT(condition_config, '$.mode')) = 'king_of_the_hill';
