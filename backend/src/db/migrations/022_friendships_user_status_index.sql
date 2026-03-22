-- Composite index for friendship queries filtered by user_id + status
-- Optimizes: friend list, friend count, pending requests, etc.
CREATE INDEX idx_friendships_user_status ON friendships(user_id, status);
