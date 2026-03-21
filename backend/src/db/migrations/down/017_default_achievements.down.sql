-- Rollback: remove default achievement pack (25 cosmetics + 47 achievements)
-- Foreign keys with CASCADE on user_achievements and user_cosmetics handle user data cleanup

DELETE FROM achievements WHERE name IN (
  'First Blood', 'Slayer', 'Destroyer', 'Annihilator',
  'Bomb Novice', 'Bomb Enthusiast', 'Bomb Maniac',
  'Power Collector', 'Power Hoarder',
  'Killing Spree', 'Rampage', 'Sharpshooter',
  'Untouchable', 'Sole Survivor', 'Bomb Frenzy',
  'First Win', 'Veteran Victor', 'Champion', 'Legend',
  'Hot Streak', 'Unstoppable', 'Dominator',
  'Pacifist Win', 'Marathon Survivor', 'Speed Demon',
  'Getting Started', 'Regular', 'Dedicated', 'Addict',
  'Time Served', 'Long Haul', 'Lifer',
  'FFA Master', 'Team Player', 'Battle Royale Champ',
  'Sudden Death Ace', 'Deathmatch King', 'Hill Holder',
  'Campaign Beginner', 'Campaign Veteran', 'Campaign Master',
  'Star Collector', 'Star Hunter', 'Star Master',
  'Star Legend', 'Completionist', 'Star Perfectionist'
);

DELETE FROM cosmetics WHERE name IN (
  'Frost', 'Toxic', 'Sunset', 'Royal',
  'Obsidian', 'Inferno', 'Aurora',
  'Plasma', 'Solar',
  'Angry Eyes', 'Cyclops Eye', 'Dot Eyes',
  'Fire Trail', 'Smoke Trail', 'Spark Trail',
  'Star Trail', 'Shield Trail', 'Debris Trail',
  'Frostbomb', 'Firebomb', 'Ghostbomb', 'Royalbomb', 'Starbomb',
  'Stargazer', 'Nebula'
);
