-- Buddy mode settings (name, color, size) saved per user account
CREATE TABLE IF NOT EXISTS buddy_settings (
  user_id INT PRIMARY KEY,
  buddy_name VARCHAR(20) NOT NULL DEFAULT 'Buddy',
  buddy_color VARCHAR(7) NOT NULL DEFAULT '#44aaff',
  buddy_size DECIMAL(3,2) NOT NULL DEFAULT 0.60,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
