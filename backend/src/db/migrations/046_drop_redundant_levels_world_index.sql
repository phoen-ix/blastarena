-- 035 added idx_levels_world (world_id), a leftmost prefix of 008's idx_levels_world_order
-- (world_id, sort_order). Every lookup it served — the per-world COUNT(*) subqueries included —
-- is served by the composite index, which also covers the world_id foreign key; the duplicate
-- only cost a second index write on every level insert and move.
DROP INDEX IF EXISTS idx_levels_world ON campaign_levels;
