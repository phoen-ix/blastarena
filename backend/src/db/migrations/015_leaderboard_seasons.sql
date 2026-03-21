-- Seasons for Elo tracking
CREATE TABLE seasons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_seasons_active (is_active)
);

-- Per-season Elo for each user
CREATE TABLE season_elo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  season_id INT NOT NULL,
  elo_rating INT NOT NULL DEFAULT 1000,
  peak_elo INT NOT NULL DEFAULT 1000,
  matches_played INT NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
  UNIQUE KEY uk_user_season (user_id, season_id),
  INDEX idx_season_elo_ranking (season_id, elo_rating DESC)
);

-- Elo change history per match
CREATE TABLE elo_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  match_id INT NOT NULL,
  season_id INT NULL,
  old_elo INT NOT NULL,
  new_elo INT NOT NULL,
  delta INT NOT NULL,
  game_mode VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  INDEX idx_elo_history_user (user_id, created_at DESC)
);

-- Privacy and friend request settings on users
ALTER TABLE users ADD COLUMN is_profile_public BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN accept_friend_requests BOOLEAN NOT NULL DEFAULT TRUE;

-- Peak Elo tracking in user_stats
ALTER TABLE user_stats ADD COLUMN peak_elo INT NOT NULL DEFAULT 1000;

-- Default rank tier configuration
INSERT INTO server_settings (setting_key, setting_value) VALUES
  ('rank_tiers', '{"tiers":[{"name":"Bronze","minElo":0,"maxElo":999,"color":"#cd7f32"},{"name":"Silver","minElo":1000,"maxElo":1199,"color":"#c0c0c0"},{"name":"Gold","minElo":1200,"maxElo":1399,"color":"#ffd700"},{"name":"Platinum","minElo":1400,"maxElo":1599,"color":"#00d4aa"},{"name":"Diamond","minElo":1600,"maxElo":1799,"color":"#448aff"},{"name":"Champion","minElo":1800,"maxElo":99999,"color":"#ff3355"}],"subTiersEnabled":true}')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
