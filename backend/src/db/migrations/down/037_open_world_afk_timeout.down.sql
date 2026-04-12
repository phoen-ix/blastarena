-- Remove AFK timeout setting
DELETE FROM server_settings WHERE setting_key = 'open_world_afk_timeout';
