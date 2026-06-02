-- Remove AFK timeout setting only if it still holds the migration's default value, so an
-- admin-customized value is not silently lost on rollback. (audit DMIG-4)
DELETE FROM server_settings WHERE setting_key = 'open_world_afk_timeout' AND setting_value = '60';
