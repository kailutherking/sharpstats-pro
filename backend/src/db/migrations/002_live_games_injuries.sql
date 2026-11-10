-- Live game tracker and injury intelligence (1.5.0).

-- One row per ESPN event the tracker has seen, linked to the odds board game when matched.
CREATE TABLE IF NOT EXISTS games (
  league VARCHAR(8) NOT NULL,
  event_id VARCHAR(40) NOT NULL,
  name VARCHAR(200) NOT NULL,
  short_name VARCHAR(40) NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  status VARCHAR(12) NOT NULL,
  status_detail VARCHAR(80) NOT NULL DEFAULT '',
  home_team_id VARCHAR(20) NOT NULL,
  away_team_id VARCHAR(20) NOT NULL,
  home_team VARCHAR(120) NOT NULL,
  away_team VARCHAR(120) NOT NULL,
  home_abbr VARCHAR(12) NOT NULL DEFAULT '',
  away_abbr VARCHAR(12) NOT NULL DEFAULT '',
  odds_game_id VARCHAR(100),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (league, event_id)
);
CREATE INDEX IF NOT EXISTS games_start_idx ON games(league, start_time);

-- Score and situation changes during a game (change-only).
CREATE TABLE IF NOT EXISTS live_scores (
  id BIGSERIAL PRIMARY KEY,
  league VARCHAR(8) NOT NULL,
  event_id VARCHAR(40) NOT NULL,
  status VARCHAR(12) NOT NULL,
  period INTEGER NOT NULL DEFAULT 0,
  clock VARCHAR(12),
  home_score INTEGER,
  away_score INTEGER,
  possession_team_id VARCHAR(20),
  home_win_probability NUMERIC(6, 4),
  situation JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS live_scores_event_idx ON live_scores(league, event_id, recorded_at);

-- Latest box score line per player, game and stat group (NFL passing/rushing, MLB batting/pitching).
CREATE TABLE IF NOT EXISTS player_game_stats (
  league VARCHAR(8) NOT NULL,
  event_id VARCHAR(40) NOT NULL,
  player_id VARCHAR(20) NOT NULL,
  stat_group VARCHAR(20) NOT NULL,
  team_id VARCHAR(20) NOT NULL,
  player_name VARCHAR(120) NOT NULL,
  position VARCHAR(8) NOT NULL DEFAULT '',
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (league, event_id, player_id, stat_group)
);
CREATE INDEX IF NOT EXISTS player_game_stats_player_idx ON player_game_stats(league, player_id);

-- In-game moneyline, spread and total (best multi-book price, or ESPN's DraftKings line), change-only.
CREATE TABLE IF NOT EXISTS live_odds_snapshots (
  id BIGSERIAL PRIMARY KEY,
  league VARCHAR(8) NOT NULL,
  event_id VARCHAR(40) NOT NULL,
  odds_game_id VARCHAR(100),
  market_key VARCHAR(20) NOT NULL,
  side VARCHAR(8) NOT NULL,
  point NUMERIC(10, 2),
  price_american INTEGER NOT NULL,
  source VARCHAR(12) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS live_odds_snapshots_event_idx ON live_odds_snapshots(league, event_id, recorded_at);

-- Current injury report entry per player (active = still listed by the team).
CREATE TABLE IF NOT EXISTS injuries (
  league VARCHAR(8) NOT NULL,
  athlete_id VARCHAR(20) NOT NULL,
  player_name VARCHAR(120) NOT NULL,
  team_id VARCHAR(20) NOT NULL,
  team_name VARCHAR(120) NOT NULL,
  team_abbr VARCHAR(12) NOT NULL DEFAULT '',
  position VARCHAR(8) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL,
  provider_status VARCHAR(40) NOT NULL DEFAULT '',
  injury_type VARCHAR(80),
  body_location VARCHAR(60),
  injury_detail VARCHAR(80),
  side VARCHAR(20),
  return_date DATE,
  short_comment TEXT NOT NULL DEFAULT '',
  long_comment TEXT NOT NULL DEFAULT '',
  reported_at TIMESTAMPTZ NOT NULL,
  first_reported_at TIMESTAMPTZ NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'ESPN',
  headshot VARCHAR(300),
  importance INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  cleared_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (league, athlete_id)
);
CREATE INDEX IF NOT EXISTS injuries_team_idx ON injuries(league, team_id) WHERE active;

-- Every status, injury or note change observed, plus removals ("Cleared").
CREATE TABLE IF NOT EXISTS injury_history (
  id BIGSERIAL PRIMARY KEY,
  league VARCHAR(8) NOT NULL,
  athlete_id VARCHAR(20) NOT NULL,
  player_name VARCHAR(120) NOT NULL,
  team_id VARCHAR(20) NOT NULL,
  status VARCHAR(24) NOT NULL,
  previous_status VARCHAR(24),
  injury_type VARCHAR(80),
  body_location VARCHAR(60),
  return_date DATE,
  comment TEXT,
  reported_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS injury_history_player_idx ON injury_history(league, athlete_id, recorded_at DESC);

-- Latest betting impact estimate per injured player.
CREATE TABLE IF NOT EXISTS injury_impact (
  league VARCHAR(8) NOT NULL,
  athlete_id VARCHAR(20) NOT NULL,
  status VARCHAR(24) NOT NULL,
  importance INTEGER NOT NULL,
  tier VARCHAR(12) NOT NULL,
  projected_impact INTEGER NOT NULL,
  rating_change NUMERIC(8, 2) NOT NULL,
  rating_unit VARCHAR(8) NOT NULL,
  win_impact NUMERIC(8, 4) NOT NULL,
  offensive_change NUMERIC(8, 2) NOT NULL,
  defensive_change NUMERIC(8, 2) NOT NULL,
  fantasy_per_game NUMERIC(8, 2),
  prop_level VARCHAR(12) NOT NULL,
  basis TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (league, athlete_id)
);

-- Team health score history (one row whenever a team's score or counts change).
CREATE TABLE IF NOT EXISTS team_health (
  id BIGSERIAL PRIMARY KEY,
  league VARCHAR(8) NOT NULL,
  team_id VARCHAR(20) NOT NULL,
  team_name VARCHAR(120) NOT NULL,
  health_score INTEGER NOT NULL,
  label VARCHAR(20) NOT NULL,
  active_injuries INTEGER NOT NULL DEFAULT 0,
  out_count INTEGER NOT NULL DEFAULT 0,
  questionable_count INTEGER NOT NULL DEFAULT 0,
  returning_count INTEGER NOT NULL DEFAULT 0,
  suspended_count INTEGER NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS team_health_team_idx ON team_health(league, team_id, recorded_at DESC);
