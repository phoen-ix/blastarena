-- Default achievement pack: 25 cosmetics + 47 achievements
-- Cosmetics must be inserted first since achievements reference them via reward_id

-- ─── COSMETIC REWARDS ────────────────────────────────────────────────────────

INSERT INTO cosmetics (name, type, config, rarity, unlock_type, unlock_requirement, sort_order) VALUES
  -- Rare Colors (offsets 0-3)
  ('Frost',       'color',     '{"hex":"0x88ddff"}', 'rare',      'achievement', NULL, 10),
  ('Toxic',       'color',     '{"hex":"0x88ff44"}', 'rare',      'achievement', NULL, 11),
  ('Sunset',      'color',     '{"hex":"0xff7744"}', 'rare',      'achievement', NULL, 12),
  ('Royal',       'color',     '{"hex":"0x6644ff"}', 'rare',      'achievement', NULL, 13),
  -- Epic Colors (offsets 4-6)
  ('Obsidian',    'color',     '{"hex":"0x222233"}', 'epic',      'achievement', NULL, 20),
  ('Inferno',     'color',     '{"hex":"0xff2200"}', 'epic',      'achievement', NULL, 21),
  ('Aurora',      'color',     '{"hex":"0x44ffbb"}', 'epic',      'achievement', NULL, 22),
  -- Legendary Colors (offsets 7-8)
  ('Plasma',      'color',     '{"hex":"0xdd44ff"}', 'legendary', 'achievement', NULL, 30),
  ('Solar',       'color',     '{"hex":"0xffdd00"}', 'legendary', 'achievement', NULL, 31),
  -- Eye Styles (offsets 9-11)
  ('Angry Eyes',  'eyes',      '{"style":"angry"}',   'rare',      'achievement', NULL, 0),
  ('Cyclops Eye', 'eyes',      '{"style":"cyclops"}',  'epic',      'achievement', NULL, 1),
  ('Dot Eyes',    'eyes',      '{"style":"dot"}',     'rare',      'achievement', NULL, 2),
  -- Trails (offsets 12-17)
  ('Fire Trail',   'trail', '{"particleKey":"particle_fire","tint":16744448,"frequency":80}',   'rare',      'achievement', NULL, 0),
  ('Smoke Trail',  'trail', '{"particleKey":"particle_smoke","tint":8947848,"frequency":100}',  'rare',      'achievement', NULL, 1),
  ('Spark Trail',  'trail', '{"particleKey":"particle_spark","tint":16776960,"frequency":60}',  'epic',      'achievement', NULL, 2),
  ('Star Trail',   'trail', '{"particleKey":"particle_star","tint":16777060,"frequency":70}',   'epic',      'achievement', NULL, 3),
  ('Shield Trail', 'trail', '{"particleKey":"particle_shield","tint":54442,"frequency":90}',    'legendary', 'achievement', NULL, 4),
  ('Debris Trail', 'trail', '{"particleKey":"particle_debris","tint":11173120,"frequency":80}', 'rare',      'achievement', NULL, 5),
  -- Bomb Skins (offsets 18-22)
  ('Frostbomb',  'bomb_skin', '{"baseColor":4500223,"fuseColor":8900863,"label":"frost"}',  'rare',      'achievement', NULL, 0),
  ('Firebomb',   'bomb_skin', '{"baseColor":15275008,"fuseColor":16755200,"label":"fire"}', 'rare',      'achievement', NULL, 1),
  ('Ghostbomb',  'bomb_skin', '{"baseColor":11184810,"fuseColor":14540253,"label":"ghost"}','epic',      'achievement', NULL, 2),
  ('Royalbomb',  'bomb_skin', '{"baseColor":4456703,"fuseColor":16764160,"label":"royal"}', 'epic',      'achievement', NULL, 3),
  ('Starbomb',   'bomb_skin', '{"baseColor":16764160,"fuseColor":16777215,"label":"star"}', 'legendary', 'achievement', NULL, 4),
  -- Campaign Stars Cosmetics (offsets 23-24)
  ('Stargazer',  'color', '{"hex":"0xffee88"}',                                              'epic',      'campaign_stars', '{"totalStars":30}', 40),
  ('Nebula',     'trail', '{"particleKey":"particle_star","tint":11141375,"frequency":50}',   'legendary', 'campaign_stars', '{"totalStars":60}', 6);

SET @fc = LAST_INSERT_ID();

-- ─── ACHIEVEMENTS: combat ────────────────────────────────────────────────────

INSERT INTO achievements (name, description, icon, category, condition_type, condition_config, reward_type, reward_id, sort_order) VALUES
  ('First Blood',      'Get your first kill',                        '🗡️', 'combat', 'cumulative', '{"stat":"total_kills","threshold":1}',      'none',     NULL,        0),
  ('Slayer',           'Reach 50 total kills',                       '⚔️', 'combat', 'cumulative', '{"stat":"total_kills","threshold":50}',     'cosmetic', @fc + 0,     1),
  ('Destroyer',        'Reach 250 total kills',                      '💀', 'combat', 'cumulative', '{"stat":"total_kills","threshold":250}',    'cosmetic', @fc + 1,     2),
  ('Annihilator',      'Reach 1000 total kills',                     '☠️', 'combat', 'cumulative', '{"stat":"total_kills","threshold":1000}',   'cosmetic', @fc + 5,     3),
  ('Bomb Novice',      'Place 100 bombs',                            '💣', 'combat', 'cumulative', '{"stat":"total_bombs","threshold":100}',    'none',     NULL,        4),
  ('Bomb Enthusiast',  'Place 500 bombs',                            '🧨', 'combat', 'cumulative', '{"stat":"total_bombs","threshold":500}',    'cosmetic', @fc + 12,    5),
  ('Bomb Maniac',      'Place 2000 bombs',                           '💥', 'combat', 'cumulative', '{"stat":"total_bombs","threshold":2000}',   'cosmetic', @fc + 19,    6),
  ('Power Collector',  'Collect 100 power-ups',                      '⚡', 'combat', 'cumulative', '{"stat":"total_powerups","threshold":100}',  'cosmetic', @fc + 13,    7),
  ('Power Hoarder',    'Collect 500 power-ups',                      '🔋', 'combat', 'cumulative', '{"stat":"total_powerups","threshold":500}',  'cosmetic', @fc + 14,    8),
  ('Killing Spree',    'Get 5+ kills in a single game',             '🔥', 'combat', 'per_game',   '{"stat":"kills","operator":">=","threshold":5}',  'cosmetic', @fc + 9,  9),
  ('Rampage',          'Get 8+ kills in a single game',             '😤', 'combat', 'per_game',   '{"stat":"kills","operator":">=","threshold":8}',  'cosmetic', @fc + 4, 10),
  ('Sharpshooter',     'Get 3+ kills in a single game',             '🎯', 'combat', 'per_game',   '{"stat":"kills","operator":">=","threshold":3}',  'cosmetic', @fc + 2, 11),
  ('Untouchable',      'Finish a game without dying',                '🛡️', 'combat', 'per_game',   '{"stat":"deaths","operator":"==","threshold":0}', 'none',     NULL,    12),
  ('Sole Survivor',    'Finish in 1st place',                        '👑', 'combat', 'per_game',   '{"stat":"placement","operator":"==","threshold":1}','none',    NULL,    13),
  ('Bomb Frenzy',      'Place 20+ bombs in a single game',          '🎆', 'combat', 'per_game',   '{"stat":"bombs_placed","operator":">=","threshold":20}','cosmetic',@fc + 17, 14);

-- ─── ACHIEVEMENTS: victory ───────────────────────────────────────────────────

INSERT INTO achievements (name, description, icon, category, condition_type, condition_config, reward_type, reward_id, sort_order) VALUES
  ('First Win',         'Win your first game',                       '🏆', 'victory', 'cumulative', '{"stat":"total_wins","threshold":1}',          'none',     NULL,       0),
  ('Veteran Victor',    'Win 25 games',                              '🥇', 'victory', 'cumulative', '{"stat":"total_wins","threshold":25}',         'cosmetic', @fc + 3,    1),
  ('Champion',          'Win 100 games',                             '🏅', 'victory', 'cumulative', '{"stat":"total_wins","threshold":100}',        'cosmetic', @fc + 15,   2),
  ('Legend',            'Win 500 games',                             '👑', 'victory', 'cumulative', '{"stat":"total_wins","threshold":500}',        'cosmetic', @fc + 7,    3),
  ('Hot Streak',        'Achieve a 3-game win streak',               '🔥', 'victory', 'cumulative', '{"stat":"best_win_streak","threshold":3}',     'cosmetic', @fc + 18,   4),
  ('Unstoppable',       'Achieve a 5-game win streak',               '⚡', 'victory', 'cumulative', '{"stat":"best_win_streak","threshold":5}',     'cosmetic', @fc + 6,    5),
  ('Dominator',         'Achieve a 10-game win streak',              '💪', 'victory', 'cumulative', '{"stat":"best_win_streak","threshold":10}',    'cosmetic', @fc + 22,   6),
  ('Pacifist Win',      'Win without any self-kills',                '🕊️', 'victory', 'per_game',   '{"stat":"self_kills","operator":"==","threshold":0}','none', NULL,      7),
  ('Marathon Survivor', 'Survive for 4+ minutes in a game',          '⏳', 'victory', 'per_game',   '{"stat":"survived_seconds","operator":">=","threshold":240}','none',NULL, 8),
  ('Speed Demon',       'Win a game in under 60 seconds',            '⏱️', 'victory', 'per_game',   '{"stat":"survived_seconds","operator":"<=","threshold":60}','none',NULL, 9);

-- ─── ACHIEVEMENTS: dedication ────────────────────────────────────────────────

INSERT INTO achievements (name, description, icon, category, condition_type, condition_config, reward_type, reward_id, sort_order) VALUES
  ('Getting Started',   'Play your first game',                      '📋', 'dedication', 'cumulative', '{"stat":"total_matches","threshold":1}',      'none',     NULL,       0),
  ('Regular',           'Play 25 games',                             '📊', 'dedication', 'cumulative', '{"stat":"total_matches","threshold":25}',     'none',     NULL,       1),
  ('Dedicated',         'Play 100 games',                            '🎮', 'dedication', 'cumulative', '{"stat":"total_matches","threshold":100}',    'cosmetic', @fc + 11,   2),
  ('Addict',            'Play 500 games',                            '🕹️', 'dedication', 'cumulative', '{"stat":"total_matches","threshold":500}',    'cosmetic', @fc + 20,   3),
  ('Time Served',       'Play for 1 hour total',                     '⏰', 'dedication', 'cumulative', '{"stat":"total_playtime","threshold":3600}',   'none',     NULL,       4),
  ('Long Haul',         'Play for 10 hours total',                   '🌙', 'dedication', 'cumulative', '{"stat":"total_playtime","threshold":36000}',  'cosmetic', @fc + 10,   5),
  ('Lifer',             'Play for 100 hours total',                  '🌟', 'dedication', 'cumulative', '{"stat":"total_playtime","threshold":360000}', 'cosmetic', @fc + 8,    6);

-- ─── ACHIEVEMENTS: mode_mastery ──────────────────────────────────────────────

INSERT INTO achievements (name, description, icon, category, condition_type, condition_config, reward_type, reward_id, sort_order) VALUES
  ('FFA Master',          'Win 10 Free for All games',               '🏟️', 'mode_mastery', 'mode_specific', '{"mode":"ffa","stat":"wins","threshold":10}',           'none',     NULL,       0),
  ('Team Player',         'Win 10 Teams games',                      '🤝', 'mode_mastery', 'mode_specific', '{"mode":"teams","stat":"wins","threshold":10}',          'none',     NULL,       1),
  ('Battle Royale Champ', 'Win 10 Battle Royale games',              '🏝️', 'mode_mastery', 'mode_specific', '{"mode":"battle_royale","stat":"wins","threshold":10}',  'cosmetic', @fc + 16,   2),
  ('Sudden Death Ace',    'Win 10 Sudden Death games',               '⚡', 'mode_mastery', 'mode_specific', '{"mode":"sudden_death","stat":"wins","threshold":10}',   'none',     NULL,       3),
  ('Deathmatch King',     'Win 10 Deathmatch games',                 '🎯', 'mode_mastery', 'mode_specific', '{"mode":"deathmatch","stat":"wins","threshold":10}',     'none',     NULL,       4),
  ('Hill Holder',         'Win 10 King of the Hill games',           '⛰️', 'mode_mastery', 'mode_specific', '{"mode":"koth","stat":"wins","threshold":10}',           'cosmetic', @fc + 21,   5);

-- ─── ACHIEVEMENTS: campaign ──────────────────────────────────────────────────

INSERT INTO achievements (name, description, icon, category, condition_type, condition_config, reward_type, reward_id, sort_order) VALUES
  ('Campaign Beginner',   'Complete your first campaign level',      '🌱', 'campaign', 'campaign', '{"subType":"levels_completed","threshold":1}',   'none', NULL, 0),
  ('Campaign Veteran',    'Complete 10 campaign levels',             '🗺️', 'campaign', 'campaign', '{"subType":"levels_completed","threshold":10}',  'none', NULL, 1),
  ('Campaign Master',     'Complete 25 campaign levels',             '🏰', 'campaign', 'campaign', '{"subType":"levels_completed","threshold":25}',  'none', NULL, 2),
  ('Star Collector',      'Earn 10 campaign stars',                  '⭐', 'campaign', 'campaign', '{"subType":"total_stars","threshold":10}',       'none', NULL, 3),
  ('Star Hunter',         'Earn 30 campaign stars',                  '🌟', 'campaign', 'campaign', '{"subType":"total_stars","threshold":30}',       'none', NULL, 4),
  ('Star Master',         'Earn 50 campaign stars',                  '💫', 'campaign', 'campaign', '{"subType":"total_stars","threshold":50}',       'none', NULL, 5),
  ('Star Legend',          'Earn 75 campaign stars',                  '✨', 'campaign', 'campaign', '{"subType":"total_stars","threshold":75}',       'none', NULL, 6),
  ('Completionist',       'Complete 50 campaign levels',             '🏅', 'campaign', 'campaign', '{"subType":"levels_completed","threshold":50}',  'none', NULL, 7),
  ('Star Perfectionist',  'Earn 100 campaign stars',                 '🌠', 'campaign', 'campaign', '{"subType":"total_stars","threshold":100}',      'none', NULL, 8);
