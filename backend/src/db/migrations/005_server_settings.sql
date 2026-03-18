CREATE TABLE IF NOT EXISTS server_settings (
  setting_key VARCHAR(64) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO server_settings (setting_key, setting_value) VALUES ('recordings_enabled', 'true')
