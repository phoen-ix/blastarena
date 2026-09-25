-- best_win_streak was recorded one too high on every win: the stats UPDATE assigned win_streak
-- first, and MariaDB evaluates SET left to right with updated values, so the best-streak
-- expression saw the already-incremented streak. That UPDATE is the column's only writer, so every
-- row with best_win_streak > 0 holds the true best + 1.
UPDATE user_stats SET best_win_streak = best_win_streak - 1 WHERE best_win_streak > 0;
