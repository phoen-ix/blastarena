-- Built-in enemy AIs are identified by an explicit key instead of "no uploader", which a
-- re-upload kept and a deleted uploader account produced. Existing seeded rows are adopted by
-- name; the server replaces every built-in's code with the repository source at startup.
-- IF NOT EXISTS: each ALTER commits on its own, so a run that failed after one of them left it in
-- place without recording the migration, and every restart then stopped at "Duplicate column".
-- The UPDATEs pick the same row when repeated: `id` breaks uploaded_at ties, which could otherwise
-- tag a second row and collide with the unique index.
ALTER TABLE enemy_ais ADD COLUMN IF NOT EXISTS builtin_key VARCHAR(32) NULL;
ALTER TABLE enemy_ais ADD UNIQUE INDEX IF NOT EXISTS uq_enemy_ais_builtin_key (builtin_key);
UPDATE enemy_ais SET builtin_key = 'hunter' WHERE uploaded_by IS NULL AND name = 'Hunter' ORDER BY uploaded_at, id LIMIT 1;
UPDATE enemy_ais SET builtin_key = 'patrol-guard' WHERE uploaded_by IS NULL AND name = 'Patrol Guard' ORDER BY uploaded_at, id LIMIT 1;
UPDATE enemy_ais SET builtin_key = 'bomber' WHERE uploaded_by IS NULL AND name = 'Bomber' ORDER BY uploaded_at, id LIMIT 1;
UPDATE enemy_ais SET builtin_key = 'coward' WHERE uploaded_by IS NULL AND name = 'Coward' ORDER BY uploaded_at, id LIMIT 1;
UPDATE enemy_ais SET builtin_key = 'swarm' WHERE uploaded_by IS NULL AND name = 'Swarm' ORDER BY uploaded_at, id LIMIT 1;
UPDATE enemy_ais SET builtin_key = 'ambusher' WHERE uploaded_by IS NULL AND name = 'Ambusher' ORDER BY uploaded_at, id LIMIT 1;
