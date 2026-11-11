-- NCAA Division I men's basketball and the simulated betting system (1.7.0).

-- Favorites may now be college players and teams.
ALTER TABLE favorite_stats DROP CONSTRAINT IF EXISTS favorite_stats_league_check;
ALTER TABLE favorite_stats ADD CONSTRAINT favorite_stats_league_check CHECK (league IN ('nba', 'nfl', 'mlb', 'nhl', 'ncaab'));

-- Simulated wagers are mirrored into bets so the tracker, analytics and Sharp Insights include them.
ALTER TABLE bets ADD COLUMN IF NOT EXISTS source VARCHAR(12) NOT NULL DEFAULT 'manual';

-- NCAA reference data, rebuilt from the provider on every stats refresh (so a new season, a
-- conference realignment or a program moving up to Division I is picked up automatically).
CREATE TABLE IF NOT EXISTS ncaa_conferences (
  conference_id VARCHAR(24) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  season INTEGER NOT NULL,
  team_count INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ncaa_teams (
  team_id VARCHAR(12) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  short_name VARCHAR(80) NOT NULL DEFAULT '',
  abbr VARCHAR(12) NOT NULL DEFAULT '',
  logo TEXT,
  conference_id VARCHAR(24),
  conference VARCHAR(120) NOT NULL DEFAULT '',
  season INTEGER NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  record VARCHAR(12) NOT NULL DEFAULT '',
  home_record VARCHAR(12) NOT NULL DEFAULT '',
  away_record VARCHAR(12) NOT NULL DEFAULT '',
  conference_record VARCHAR(12) NOT NULL DEFAULT '',
  streak VARCHAR(8) NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ncaa_teams_conference_idx ON ncaa_teams(conference_id);

CREATE TABLE IF NOT EXISTS ncaa_players (
  athlete_id VARCHAR(14) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  team_id VARCHAR(12) NOT NULL DEFAULT '',
  position VARCHAR(8) NOT NULL DEFAULT '',
  headshot TEXT,
  season INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ncaa_players_team_idx ON ncaa_players(team_id);

-- One row per team per poll per release (AP, Coaches, NET, KenPom).
CREATE TABLE IF NOT EXISTS ncaa_rankings (
  season INTEGER NOT NULL,
  poll VARCHAR(10) NOT NULL CHECK (poll IN ('ap', 'coaches', 'net', 'kenpom')),
  release VARCHAR(60) NOT NULL,
  team_name VARCHAR(120) NOT NULL,
  team_id VARCHAR(12),
  rank INTEGER NOT NULL,
  previous_rank INTEGER,
  points NUMERIC(10, 2),
  first_place_votes INTEGER,
  record VARCHAR(12) NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season, poll, release, team_name)
);
CREATE INDEX IF NOT EXISTS ncaa_rankings_team_idx ON ncaa_rankings(team_id, poll);

-- Season statistics per team or player (the computed columns the API serves).
CREATE TABLE IF NOT EXISTS ncaa_statistics (
  season INTEGER NOT NULL,
  entity_type VARCHAR(8) NOT NULL CHECK (entity_type IN ('team', 'player')),
  entity_id VARCHAR(14) NOT NULL,
  stats JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season, entity_type, entity_id)
);

-- Simulated betting -----------------------------------------------------------------------
-- No real money moves anywhere in this system: these tables are a paper-trading ledger.

-- One submitted bet slip (a batch of singles, or one parlay).
CREATE TABLE IF NOT EXISTS bet_slips (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slip_type VARCHAR(8) NOT NULL CHECK (slip_type IN ('single', 'parlay', 'sgp')),
  wager_count INTEGER NOT NULL,
  leg_count INTEGER NOT NULL,
  total_stake NUMERIC(12, 2) NOT NULL CHECK (total_stake > 0),
  potential_payout NUMERIC(14, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bet_slips_user_idx ON bet_slips(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS simulated_bets (
  id BIGSERIAL PRIMARY KEY,
  slip_id BIGINT NOT NULL REFERENCES bet_slips(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bet_id INTEGER NOT NULL UNIQUE REFERENCES bets(id) ON DELETE CASCADE,
  bet_type VARCHAR(16) NOT NULL CHECK (bet_type IN ('moneyline', 'spread', 'total', 'team_total', 'player_prop', 'parlay', 'sgp', 'future')),
  sport VARCHAR(12) NOT NULL,
  conference VARCHAR(120) NOT NULL DEFAULT '',
  sportsbook VARCHAR(80) NOT NULL,
  book_key VARCHAR(40) NOT NULL,
  description VARCHAR(400) NOT NULL,
  stake NUMERIC(12, 2) NOT NULL CHECK (stake > 0),
  odds_decimal NUMERIC(12, 4) NOT NULL CHECK (odds_decimal > 1),
  odds_american INTEGER NOT NULL,
  potential_payout NUMERIC(14, 2) NOT NULL,
  status VARCHAR(8) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'push', 'void')),
  payout NUMERIC(14, 2) NOT NULL DEFAULT 0,
  profit_loss NUMERIC(14, 2) NOT NULL DEFAULT 0,
  units NUMERIC(10, 4) NOT NULL DEFAULT 0,
  risk_pct NUMERIC(8, 4) NOT NULL DEFAULT 0,
  bankroll_before NUMERIC(12, 2) NOT NULL DEFAULT 0,
  fair_probability NUMERIC(8, 5),
  ev_pct NUMERIC(9, 3),
  closing_odds_decimal NUMERIC(12, 4),
  clv_pct NUMERIC(9, 3),
  placed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS simulated_bets_user_idx ON simulated_bets(user_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS simulated_bets_open_idx ON simulated_bets(status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS simulated_bet_legs (
  id BIGSERIAL PRIMARY KEY,
  sim_bet_id BIGINT NOT NULL REFERENCES simulated_bets(id) ON DELETE CASCADE,
  leg_index INTEGER NOT NULL DEFAULT 0,
  sport VARCHAR(12) NOT NULL,
  game_id VARCHAR(100) NOT NULL,
  espn_event_id VARCHAR(20),
  event VARCHAR(220) NOT NULL,
  home_team VARCHAR(120) NOT NULL DEFAULT '',
  away_team VARCHAR(120) NOT NULL DEFAULT '',
  commence_time TIMESTAMPTZ,
  market_key VARCHAR(60) NOT NULL,
  market_type VARCHAR(12) NOT NULL,
  period VARCHAR(6) NOT NULL DEFAULT 'game',
  selection VARCHAR(180) NOT NULL,
  participant VARCHAR(180) NOT NULL DEFAULT '',
  point NUMERIC(10, 2),
  label VARCHAR(300) NOT NULL,
  conference VARCHAR(120) NOT NULL DEFAULT '',
  book_key VARCHAR(40) NOT NULL,
  line_id TEXT,
  odds_american INTEGER NOT NULL,
  odds_decimal NUMERIC(10, 4) NOT NULL,
  fair_probability NUMERIC(8, 5),
  closing_american INTEGER,
  status VARCHAR(8) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'push', 'void')),
  result_value NUMERIC(10, 2),
  result_note VARCHAR(200) NOT NULL DEFAULT '',
  graded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS simulated_bet_legs_bet_idx ON simulated_bet_legs(sim_bet_id);
CREATE INDEX IF NOT EXISTS simulated_bet_legs_open_idx ON simulated_bet_legs(status, commence_time) WHERE status = 'open';

-- Open positions: every simulated wager that has not been graded yet.
CREATE OR REPLACE VIEW open_wagers AS
  SELECT s.id, s.slip_id, s.user_id, s.bet_id, s.bet_type, s.sport, s.conference, s.sportsbook, s.description, s.stake,
         s.odds_decimal, s.odds_american, s.potential_payout, s.units, s.risk_pct, s.ev_pct, s.placed_at
  FROM simulated_bets s WHERE s.status = 'open';

-- Every movement of the simulated bankroll: stakes out, payouts and refunds in, manual adjustments.
CREATE TABLE IF NOT EXISTS bankroll_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('stake', 'payout', 'refund', 'adjustment')),
  amount NUMERIC(14, 2) NOT NULL,
  balance_after NUMERIC(14, 2) NOT NULL,
  sim_bet_id BIGINT REFERENCES simulated_bets(id) ON DELETE SET NULL,
  note VARCHAR(240) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bankroll_transactions_user_idx ON bankroll_transactions(user_id, created_at DESC, id DESC);
