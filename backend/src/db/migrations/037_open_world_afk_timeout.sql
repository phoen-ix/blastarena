-- Add AFK timeout setting for open world
INSERT IGNORE INTO server_settings (setting_key, setting_value)
VALUES ('open_world_afk_timeout', '60');
