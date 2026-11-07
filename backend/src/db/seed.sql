INSERT INTO sportsbooks(name, region) VALUES
  ('DraftKings', 'US'), ('FanDuel', 'US'), ('BetMGM', 'US'),
  ('Caesars', 'US'), ('ESPN BET', 'US'), ('BetRivers', 'US')
ON CONFLICT (name) DO NOTHING;
