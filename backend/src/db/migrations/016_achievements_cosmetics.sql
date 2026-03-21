-- Cosmetics system
CREATE TABLE cosmetics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type ENUM('color','eyes','trail','bomb_skin') NOT NULL,
  config JSON NOT NULL,
  rarity ENUM('common','rare','epic','legendary') NOT NULL DEFAULT 'common',
  unlock_type ENUM('achievement','campaign_stars','default') NOT NULL DEFAULT 'achievement',
  unlock_requirement JSON NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cosmetics_type (type)
);

-- User unlocked cosmetics
CREATE TABLE user_cosmetics (
  user_id INT NOT NULL,
  cosmetic_id INT NOT NULL,
  unlocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, cosmetic_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (cosmetic_id) REFERENCES cosmetics(id) ON DELETE CASCADE
);

-- User equipped cosmetic slots
CREATE TABLE user_equipped_cosmetics (
  user_id INT PRIMARY KEY,
  color_id INT NULL,
  eyes_id INT NULL,
  trail_id INT NULL,
  bomb_skin_id INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (color_id) REFERENCES cosmetics(id) ON DELETE SET NULL,
  FOREIGN KEY (eyes_id) REFERENCES cosmetics(id) ON DELETE SET NULL,
  FOREIGN KEY (trail_id) REFERENCES cosmetics(id) ON DELETE SET NULL,
  FOREIGN KEY (bomb_skin_id) REFERENCES cosmetics(id) ON DELETE SET NULL
);

-- Achievements system
CREATE TABLE achievements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500) NOT NULL,
  icon VARCHAR(10) NOT NULL DEFAULT '🏆',
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  condition_type ENUM('cumulative','per_game','mode_specific','campaign') NOT NULL,
  condition_config JSON NOT NULL,
  reward_type ENUM('cosmetic','title','none') NOT NULL DEFAULT 'none',
  reward_id INT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_achievements_type (condition_type)
);

-- User achievement progress and unlocks
CREATE TABLE user_achievements (
  user_id INT NOT NULL,
  achievement_id INT NOT NULL,
  unlocked_at TIMESTAMP NULL DEFAULT NULL,
  progress JSON NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, achievement_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE
);

-- Seed the 8 existing player colors as default cosmetics
INSERT INTO cosmetics (name, type, config, rarity, unlock_type, sort_order) VALUES
  ('Crimson','color','{"hex":"0xe94560"}','common','default',0),
  ('Azure','color','{"hex":"0x44aaff"}','common','default',1),
  ('Emerald','color','{"hex":"0x44ff44"}','common','default',2),
  ('Amber','color','{"hex":"0xff8800"}','common','default',3),
  ('Violet','color','{"hex":"0xcc44ff"}','common','default',4),
  ('Gold','color','{"hex":"0xffff44"}','common','default',5),
  ('Magenta','color','{"hex":"0xff44ff"}','common','default',6),
  ('Cyan','color','{"hex":"0x44ffff"}','common','default',7);
