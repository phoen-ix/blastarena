ALTER TABLE enemy_ais DROP INDEX IF EXISTS uq_enemy_ais_builtin_key;
ALTER TABLE enemy_ais DROP COLUMN IF EXISTS builtin_key;
