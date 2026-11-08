-- Market range history: best and worst comparable price, market average and fair value per
-- selection over time (change-only), for line-shopping spread and odds history charts.
CREATE TABLE IF NOT EXISTS odds_selection_history (
  id BIGSERIAL PRIMARY KEY,
  side_id TEXT NOT NULL,
  sport VARCHAR(8) NOT NULL,
  game_id VARCHAR(100) NOT NULL,
  market_key VARCHAR(60) NOT NULL,
  best_american INTEGER NOT NULL,
  best_book VARCHAR(40) NOT NULL,
  worst_american INTEGER,
  worst_book VARCHAR(40),
  average_implied NUMERIC(8, 5),
  fair_probability NUMERIC(8, 5),
  books INTEGER NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS odds_selection_history_side_idx ON odds_selection_history(side_id, recorded_at);
CREATE INDEX IF NOT EXISTS odds_selection_history_recorded_idx ON odds_selection_history(recorded_at);
