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

-- Stats research center: provider response cache (survives restarts; serves last good data
-- when a provider is unavailable) and per-user favorite players/teams.
CREATE TABLE IF NOT EXISTS stats_cache (
  cache_key VARCHAR(160) PRIMARY KEY,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS stats_cache_expires_idx ON stats_cache(expires_at);

CREATE TABLE IF NOT EXISTS favorite_stats (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  league VARCHAR(8) NOT NULL CHECK (league IN ('nba', 'nfl', 'mlb', 'nhl')),
  entity_type VARCHAR(8) NOT NULL CHECK (entity_type IN ('player', 'team')),
  entity_id VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  team_abbr VARCHAR(12) NOT NULL DEFAULT '',
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, league, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS favorite_stats_user_idx ON favorite_stats(user_id, created_at DESC);

-- Odds intelligence platform -------------------------------------------------------------
-- Sportsbook registry (kept in sync with services/oddsCatalog.ts at startup).
ALTER TABLE sportsbooks ADD COLUMN IF NOT EXISTS book_key VARCHAR(40);
ALTER TABLE sportsbooks ADD COLUMN IF NOT EXISTS kind VARCHAR(12) NOT NULL DEFAULT 'sportsbook';
ALTER TABLE sportsbooks ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS sportsbooks_book_key_idx ON sportsbooks(book_key) WHERE book_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS odds_games (
  id VARCHAR(100) PRIMARY KEY,
  sport VARCHAR(8) NOT NULL,
  home_team VARCHAR(120) NOT NULL,
  away_team VARCHAR(120) NOT NULL,
  home_abbr VARCHAR(12),
  away_abbr VARCHAR(12),
  commence_time TIMESTAMPTZ NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pregame' CHECK (status IN ('pregame', 'live', 'final')),
  provider VARCHAR(20) NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS odds_games_sport_time_idx ON odds_games(sport, commence_time);

CREATE TABLE IF NOT EXISTS odds_markets (
  sport VARCHAR(8) NOT NULL,
  market_key VARCHAR(60) NOT NULL,
  label VARCHAR(80) NOT NULL,
  category VARCHAR(12) NOT NULL,
  market_type VARCHAR(12) NOT NULL,
  period VARCHAR(6) NOT NULL DEFAULT 'game',
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  supported BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (sport, market_key)
);

-- Current price per (book, side) with opening, previous, peak and lowest price/line.
CREATE TABLE IF NOT EXISTS odds_lines (
  line_id TEXT PRIMARY KEY,
  side_id TEXT NOT NULL,
  game_id VARCHAR(100) NOT NULL,
  sport VARCHAR(8) NOT NULL,
  market_key VARCHAR(60) NOT NULL,
  book_key VARCHAR(40) NOT NULL,
  selection VARCHAR(180) NOT NULL,
  participant VARCHAR(180) NOT NULL DEFAULT '',
  point NUMERIC(10, 2),
  price_american INTEGER NOT NULL,
  open_american INTEGER NOT NULL,
  open_point NUMERIC(10, 2),
  open_at TIMESTAMPTZ NOT NULL,
  prev_american INTEGER,
  prev_point NUMERIC(10, 2),
  high_american INTEGER NOT NULL,
  low_american INTEGER NOT NULL,
  high_point NUMERIC(10, 2),
  low_point NUMERIC(10, 2),
  last_change_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  is_prop BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS odds_lines_game_idx ON odds_lines(game_id);
CREATE INDEX IF NOT EXISTS odds_lines_side_idx ON odds_lines(side_id);

-- Player props are lines on player markets; exposed as their own relation for reporting.
CREATE OR REPLACE VIEW odds_player_props AS
  SELECT l.line_id, l.side_id, l.game_id, l.sport, l.market_key, l.book_key, l.participant AS player, l.selection,
         l.point, l.price_american, l.open_american, l.open_point, l.high_american, l.low_american, l.last_change_at, l.last_seen_at
  FROM odds_lines l WHERE l.is_prop;

-- Change-only price history (one row per new price or line).
CREATE TABLE IF NOT EXISTS odds_history (
  id BIGSERIAL PRIMARY KEY,
  line_id TEXT NOT NULL,
  side_id TEXT NOT NULL,
  game_id VARCHAR(100) NOT NULL,
  market_key VARCHAR(60) NOT NULL,
  book_key VARCHAR(40) NOT NULL,
  point NUMERIC(10, 2),
  price_american INTEGER NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS odds_history_side_idx ON odds_history(side_id, observed_at);
CREATE INDEX IF NOT EXISTS odds_history_observed_idx ON odds_history(observed_at);

CREATE TABLE IF NOT EXISTS odds_line_movements (
  id BIGSERIAL PRIMARY KEY,
  side_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  sport VARCHAR(8) NOT NULL,
  game_id VARCHAR(100) NOT NULL,
  market_key VARCHAR(60) NOT NULL,
  book_key VARCHAR(40) NOT NULL,
  selection VARCHAR(180) NOT NULL,
  participant VARCHAR(180) NOT NULL DEFAULT '',
  from_american INTEGER NOT NULL,
  to_american INTEGER NOT NULL,
  from_point NUMERIC(10, 2),
  to_point NUMERIC(10, 2),
  probability_delta NUMERIC(8, 5) NOT NULL,
  direction SMALLINT NOT NULL,
  moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS odds_line_movements_sport_idx ON odds_line_movements(sport, moved_at DESC);

CREATE TABLE IF NOT EXISTS odds_ev_history (
  id BIGSERIAL PRIMARY KEY,
  side_id TEXT NOT NULL,
  book_key VARCHAR(40) NOT NULL,
  price_american INTEGER NOT NULL,
  sport VARCHAR(8) NOT NULL,
  game_id VARCHAR(100) NOT NULL,
  market_key VARCHAR(60) NOT NULL,
  label VARCHAR(240) NOT NULL,
  fair_probability NUMERIC(8, 5) NOT NULL,
  ev NUMERIC(8, 5) NOT NULL,
  peak_ev NUMERIC(8, 5) NOT NULL,
  kelly NUMERIC(8, 5) NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS odds_ev_history_open_idx ON odds_ev_history(side_id, book_key, price_american) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS odds_ev_history_sport_idx ON odds_ev_history(sport, first_seen_at DESC);

CREATE TABLE IF NOT EXISTS odds_arbitrage (
  signature TEXT PRIMARY KEY,
  sport VARCHAR(8) NOT NULL,
  game_id VARCHAR(100) NOT NULL,
  market_key VARCHAR(60) NOT NULL,
  participant VARCHAR(180) NOT NULL DEFAULT '',
  profit_pct NUMERIC(8, 5) NOT NULL,
  peak_profit_pct NUMERIC(8, 5) NOT NULL,
  legs JSONB NOT NULL,
  books TEXT NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS odds_arbitrage_sport_idx ON odds_arbitrage(sport, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS odds_refresh_log (
  id BIGSERIAL PRIMARY KEY,
  sport VARCHAR(8) NOT NULL,
  scope VARCHAR(20) NOT NULL,
  provider VARCHAR(20) NOT NULL,
  status VARCHAR(8) NOT NULL,
  quotes INTEGER NOT NULL DEFAULT 0,
  credits_remaining INTEGER,
  credits_last INTEGER,
  error TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS odds_refresh_log_sport_idx ON odds_refresh_log(sport, created_at DESC);

CREATE TABLE IF NOT EXISTS odds_alerts (
  id BIGSERIAL PRIMARY KEY,
  signature TEXT NOT NULL UNIQUE,
  alert_type VARCHAR(16) NOT NULL,
  sport VARCHAR(8) NOT NULL,
  game_id VARCHAR(100) NOT NULL,
  game_label VARCHAR(260) NOT NULL DEFAULT '',
  market_key VARCHAR(60) NOT NULL DEFAULT '',
  side_id TEXT,
  book_key VARCHAR(40),
  title VARCHAR(260) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(8) NOT NULL DEFAULT 'info',
  value NUMERIC(10, 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS odds_alerts_created_idx ON odds_alerts(created_at DESC);

CREATE TABLE IF NOT EXISTS odds_alert_rules (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(60) NOT NULL,
  alert_type VARCHAR(16) NOT NULL,
  sport VARCHAR(8),
  market_key VARCHAR(60),
  book_key VARCHAR(40),
  query VARCHAR(60),
  min_value NUMERIC(10, 5),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS odds_alert_rules_user_idx ON odds_alert_rules(user_id);

CREATE TABLE IF NOT EXISTS odds_favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(8) NOT NULL CHECK (kind IN ('market', 'prop', 'game')),
  item_key VARCHAR(400) NOT NULL,
  label VARCHAR(160) NOT NULL,
  sport VARCHAR(8) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, kind, item_key)
);
