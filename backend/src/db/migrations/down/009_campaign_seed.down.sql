DELETE FROM campaign_levels WHERE world_id = (SELECT id FROM campaign_worlds WHERE name = 'Training Grounds' LIMIT 1);
DELETE FROM campaign_worlds WHERE name = 'Training Grounds';
DELETE FROM campaign_enemy_types WHERE name IN ('Blobbor', 'Spectra', 'Bombotron');
