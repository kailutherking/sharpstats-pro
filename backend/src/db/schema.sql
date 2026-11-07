CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(40) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sportsbooks (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  region VARCHAR(30) NOT NULL DEFAULT 'US'
);

CREATE TABLE IF NOT EXISTS bets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport VARCHAR(60) NOT NULL,
  league VARCHAR(80) NOT NULL DEFAULT '',
  event VARCHAR(180) NOT NULL,
  bet_type VARCHAR(80) NOT NULL DEFAULT 'Moneyline',
  team_player VARCHAR(120) NOT NULL DEFAULT '',
  odds NUMERIC(10, 3) NOT NULL CHECK (odds > 1),
  stake NUMERIC(12, 2) NOT NULL CHECK (stake > 0),
  result VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (result IN ('pending', 'win', 'loss', 'push')),
  profit_loss NUMERIC(12, 2) NOT NULL DEFAULT 0,
  sportsbook VARCHAR(80) NOT NULL,
  bet_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closing_odds NUMERIC(10, 3) CHECK (closing_odds IS NULL OR closing_odds > 1),
  market_key VARCHAR(80) NOT NULL DEFAULT 'h2h',
  selection VARCHAR(180) NOT NULL DEFAULT '',
  line_value NUMERIC(10, 3),
  event_id VARCHAR(100),
  graded_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bets_user_date_idx ON bets(user_id, bet_date DESC);
CREATE INDEX IF NOT EXISTS bets_user_result_idx ON bets(user_id, result);

CREATE TABLE IF NOT EXISTS bankroll (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  starting_bankroll NUMERIC(12, 2) NOT NULL DEFAULT 1000 CHECK (starting_bankroll >= 0),
  current_bankroll NUMERIC(12, 2) NOT NULL DEFAULT 1000 CHECK (current_bankroll >= 0),
  unit_size NUMERIC(12, 2) NOT NULL DEFAULT 25 CHECK (unit_size > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS favorite_sportsbooks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sportsbook_id INTEGER NOT NULL REFERENCES sportsbooks(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, sportsbook_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens(user_id, expires_at);

CREATE TABLE IF NOT EXISTS analytics (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  roi NUMERIC(10, 4) NOT NULL DEFAULT 0,
  win_rate NUMERIC(10, 4) NOT NULL DEFAULT 0,
  total_units NUMERIC(12, 4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bets ADD COLUMN IF NOT EXISTS market_key VARCHAR(80) NOT NULL DEFAULT 'h2h';
ALTER TABLE bets ADD COLUMN IF NOT EXISTS selection VARCHAR(180) NOT NULL DEFAULT '';
ALTER TABLE bets ADD COLUMN IF NOT EXISTS line_value NUMERIC(10, 3);
ALTER TABLE bets ADD COLUMN IF NOT EXISTS event_id VARCHAR(100);
ALTER TABLE bets ADD COLUMN IF NOT EXISTS graded_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS odds_snapshots (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id VARCHAR(100) NOT NULL,
  sport VARCHAR(80) NOT NULL,
  event VARCHAR(220) NOT NULL,
  commence_time TIMESTAMPTZ NOT NULL,
  market VARCHAR(80) NOT NULL,
  point NUMERIC(10, 3),
  outcome VARCHAR(180) NOT NULL,
  sportsbook VARCHAR(100) NOT NULL,
  decimal_odds NUMERIC(10, 3) NOT NULL CHECK (decimal_odds > 1),
  provider VARCHAR(40) NOT NULL DEFAULT 'the-odds-api',
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS odds_snapshots_lookup_idx
  ON odds_snapshots(user_id, event_id, market, outcome, sportsbook, observed_at DESC);
