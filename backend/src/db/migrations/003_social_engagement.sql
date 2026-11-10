-- Social, engagement, gamification, notifications and live game chat (1.6.0).

-- Public profile, progression and daily streak per user (extends users).
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  handle VARCHAR(30) NOT NULL UNIQUE,
  bio VARCHAR(280) NOT NULL DEFAULT '',
  avatar_url VARCHAR(500),
  favorite_sports TEXT[] NOT NULL DEFAULT '{}',
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  streak_days INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  visit_days INTEGER NOT NULL DEFAULT 0,
  last_active_date DATE,
  onboarding_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notification switches per type and other per-user settings.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notifications JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User-to-user follows (teams, players and sportsbooks use favorite_stats / favorite_sportsbooks).
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX IF NOT EXISTS follows_following_idx ON follows(following_id);

-- Picks (a shared tracked bet, snapshotted at share time) and text posts.
CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(8) NOT NULL CHECK (kind IN ('pick', 'post')),
  body VARCHAR(500) NOT NULL DEFAULT '',
  visibility VARCHAR(10) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'followers', 'private')),
  bet_id INTEGER REFERENCES bets(id) ON DELETE SET NULL,
  sport VARCHAR(60),
  league VARCHAR(80),
  event VARCHAR(180),
  event_id VARCHAR(100),
  market_key VARCHAR(80),
  bet_type VARCHAR(80),
  selection VARCHAR(180),
  line_value NUMERIC(10, 3),
  odds NUMERIC(10, 3),
  units NUMERIC(8, 2),
  sportsbook VARCHAR(80),
  event_start TIMESTAMPTZ,
  -- Shared before the start time recorded on the odds board.
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  result VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (result IN ('pending', 'win', 'loss', 'push')),
  result_units NUMERIC(10, 2),
  -- Result came from automatic score grading rather than a manual edit.
  auto_graded BOOLEAN NOT NULL DEFAULT FALSE,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS posts_user_idx ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_created_idx ON posts(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS posts_bet_idx ON posts(bet_id) WHERE bet_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS comments (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments(post_id, created_at);

CREATE TABLE IF NOT EXISTS reactions (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction VARCHAR(8) NOT NULL CHECK (reaction IN ('like', 'fire', 'lock', 'tail', 'fade')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id, reaction)
);
CREATE INDEX IF NOT EXISTS reactions_created_idx ON reactions(created_at DESC);

-- Badge catalog and the badges each user has earned.
CREATE TABLE IF NOT EXISTS badges (
  key VARCHAR(30) PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  description VARCHAR(200) NOT NULL,
  icon VARCHAR(30) NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO badges(key, name, description, icon, xp, sort_order) VALUES
  ('first_pick', 'First Pick', 'Share your first pick with the community.', 'send', 50, 1),
  ('hot_streak', 'Hot Streak', 'Win 5 settled bets in a row.', 'flame', 150, 2),
  ('roi_king', 'ROI King', 'Return 10%+ on 30 or more settled bets.', 'crown', 300, 3),
  ('sharp_bettor', 'Sharp Bettor', 'Beat the closing line on 60%+ of 20 or more bets with closing odds.', 'target', 300, 4),
  ('prop_hunter', 'Prop Hunter', 'Win 55%+ of 25 or more settled player props.', 'crosshair', 200, 5),
  ('line_shopper', 'Line Shopper', 'Track bets at 5 or more different sportsbooks.', 'shopping-bag', 100, 6),
  ('arbitrage_expert', 'Arbitrage Expert', 'Take both sides of the same market at different books 3 times.', 'split', 250, 7),
  ('grinder', 'Grinder', 'Track 100 bets.', 'layers', 150, 8),
  ('crowd_favorite', 'Crowd Favorite', 'Have your picks tailed 25 times.', 'users', 150, 9),
  ('on_a_roll', 'On a Roll', 'Open SharpStats 7 days in a row.', 'calendar', 100, 10)
ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, icon=EXCLUDED.icon, xp=EXCLUDED.xp, sort_order=EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key VARCHAR(30) NOT NULL REFERENCES badges(key) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, badge_key)
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body VARCHAR(600) NOT NULL DEFAULT '',
  link JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key VARCHAR(200),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- System events shown in activity feeds: big wins, badges, injury news and market moves.
CREATE TABLE IF NOT EXISTS feed_events (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  league VARCHAR(8),
  title VARCHAR(200) NOT NULL,
  body VARCHAR(600) NOT NULL DEFAULT '',
  ref JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key VARCHAR(200) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feed_events_created_idx ON feed_events(created_at DESC);

-- Computed leaderboard ranks, kept so rank changes can be shown.
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id BIGSERIAL PRIMARY KEY,
  metric VARCHAR(12) NOT NULL,
  period VARCHAR(4) NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  value NUMERIC(12, 4) NOT NULL,
  picks INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS leaderboard_snapshots_idx ON leaderboard_snapshots(metric, period, computed_at DESC);

-- Live game chat messages and reactions (to the game or to a single play).
CREATE TABLE IF NOT EXISTS live_game_events (
  id BIGSERIAL PRIMARY KEY,
  league VARCHAR(8) NOT NULL,
  event_id VARCHAR(40) NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(8) NOT NULL CHECK (kind IN ('chat', 'reaction')),
  body VARCHAR(280),
  reaction VARCHAR(8),
  play_id VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS live_game_events_game_idx ON live_game_events(league, event_id, created_at DESC);
