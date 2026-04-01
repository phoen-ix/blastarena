-- Map ratings: users can rate published custom maps (1-5 stars)
CREATE TABLE IF NOT EXISTS map_ratings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  map_id INT NOT NULL,
  rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (map_id) REFERENCES custom_maps(id) ON DELETE CASCADE,
  UNIQUE KEY uk_user_map_rating (user_id, map_id),
  INDEX idx_map_ratings_map (map_id)
);
