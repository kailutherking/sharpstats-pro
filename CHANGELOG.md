# Changelog

All notable changes to SharpStats Pro are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.0] - 2026-11-09

### Added
- Community page (Workspace → Community) with Feed, Picks, Leaderboards and Profile tabs, plus bettor search.
- Share pending bets as picks from the Bet tracker. Picks snapshot odds, line and units (never dollars). They're locked when shared before the start time and verified when locked and graded from the final score. Visibility can be public, followers or private.
- Reactions on picks and posts (like, fire, lock, tail, fade), comments and share. Tail opens the bet slip pre-filled with the pick.
- Pick lists: popular, most tailed, trending props, sharp bettors, top winners and latest.
- Public profiles: handle, bio, favorite sports, record from shared picks (W-L-P, units, ROI, win %, verified count), performance chart, record by sport, followers and following, badges, followed teams, players and sportsbooks, tail/fade analytics and recent picks. Profiles can be made private.
- Follow bettors. Following teams, players and sportsbooks reuses Stats favorites and favorite sportsbooks, which now drive injury notifications and feed items.
- Activity feed (everyone or following): picks, big wins, badges, injury news, sharp line moves and ESPN headlines with trade/signing tags.
- Leaderboards: global and friends; units, ROI, win rate, props and sportsbooks; 7 days, 30 days and all time; minimum sample sizes and rank change.
- Gamification: 10 badges with progress, XP, levels, ranks (Rookie to Legend), a daily streak with milestone notifications, and a dashboard progress card.
- Notification center in the header with 14 notification types, live push, unread count, toasts, deep links and per-type preferences in Settings.
- Live game room in the game view: chat, game reactions, reactions on individual plays, live viewer count, and your pending bets on the game tracked live. A background scan sends "prop cashed live" notifications.
- Mobile bottom navigation bar and a first-run setup checklist on the dashboard.
- Realtime service (`/api/realtime/stream`, Server-Sent Events) with per-user and per-game topics.
- API: `/api/social/*`, `/api/notifications/*`, `/api/realtime/stream`, `/api/live-games/:id/chat|reactions|my-bets`.
- Migration `003_social_engagement.sql`: `user_profiles`, `user_preferences`, `follows`, `posts`, `comments`, `reactions`, `badges`, `achievements`, `notifications`, `feed_events`, `leaderboard_snapshots`, `live_game_events`, with matching Prisma models.
- `docs/REAL_COMPETITIVE_ANALYSIS.md`: comparison with Real Sports, feature gap audit, priority roadmap and plans.

### Changed
- Stored odds and injury alerts now also create feed events, and notifications for matching alert rules and followed players and teams.
- Bet result changes (manual or automatic grading) update shared picks, send result or prop-hit notifications and re-check badges.

## [1.5.0] - 2026-11-09

### Added
- Live Game Tracker (Stats → Live games) for the NBA, NFL, MLB and NHL. It refreshes every 15 seconds and has a manual refresh and a last-updated time. Each game shows status (pregame, live, halftime, end of quarter/period, final), clock, period or inning, possession, score, win probability and live moneyline, spread and total.
- Sport-specific live panels: NBA timeouts, team fouls and bonus; NFL down and distance and a red-zone flag; MLB balls, strikes, outs, base runners and pitcher/batter (pitch counts in the box score); NHL shots on goal, power play (NHL official API) and recent penalties.
- Game view with linescore, win probability chart, live team stats, player leaders, a box score by stat group, recent plays and a sportsbook comparison. The comparison shows current, opening and closing odds, movement from open, coverage for the eight tracked books, on-demand quarter markets and props, and ESPN's DraftKings opening and latest lines.
- Live player tracker: current game stats, projected finish, pace, hit probability, over progress and under cushion for each prop stat. Lines come from sportsbook props or can be entered by hand.
- Injury Report page (Research → Injury report, under Stats) with ESPN injury feeds for all four leagues. Filters by team, position, status, date updated and search. The table shows player, team, position, injury, status, expected return, last updated, source and impact.
- Injury betting impact model: importance, team rating change, projected and win impact, offensive, defensive, fantasy and prop impact, and teammates likely to gain usage.
- Team health dashboard showing active, questionable, returning and suspended players and a 0–100 health score.
- Player injury page: injury details, first-reported date, recorded history, recent news, practice participation and workload restrictions taken from the report notes, and the spread before vs. now on the team's next game.
- Injury alerts in the Odds screen alert feed: player ruled out, questionable upgraded or downgraded, return announcements and line-movement correlation. There is also an "Injury impact" tab on the Odds screen.
- API: `GET /api/live-games`, `/api/live-games/:id`, `/api/live-games/player/:id`, `/api/injuries`, `/api/injuries/player/:id`, `/api/injuries/team/:id`, `/api/injuries/impact`.
- Migration `002_live_games_injuries.sql`: `games`, `live_scores`, `player_game_stats`, `live_odds_snapshots`, `injuries`, `injury_history`, `injury_impact`, `team_health` (with matching Prisma models).
- Settings `INJURY_REFRESH_MINUTES`, `LIVE_PROVIDER_TIMEOUT_MS`, `NHL_API_URL`.

### Changed
- After a server restart, the live tracker uses ESPN's DraftKings lines until the next credit-paced odds refresh is due, instead of buying an immediate refresh.

## [1.4.1] - 2026-11-08

### Added
- `GET /health` returns `{ "status": "ok" }` for platform health checks such as Railway. `/api/health` still works.

### Fixed
- The API falls back to port 4000 when `PORT` is empty or not a number, instead of failing to start. Hosts like Railway that assign `PORT` work unchanged.

## [1.4.0] - 2026-11-08

### Added
- Credit pacing for The Odds API (`ODDS_CREDIT_PACING`, `ODDS_CREDITS_RESET_DAY`). Automatic refreshes are stretched so the remaining credits, less a 20% reserve for manual refreshes, game drawers and props, last until the monthly reset. The league you're viewing gets the budget first, and background refresh pauses when it can't be afforded. The Odds screen explains the current cadence, and `/api/odds/status` returns `pacing`.
- The last quota reading and refresh times are restored from `odds_refresh_log` on restart, so restarts don't trigger a burst of paid calls.

### Changed
- Steam, sharp and reverse-line-movement signals and all alerts now cover only games that haven't started. In-play prices still show.
- EV confidence drops by 30 points for in-play prices, because books update at different speeds.
- Refresh status text no longer assumes a fixed 30-second cadence.

### Fixed
- With the free plan (500 credits/month), the default 30-second and 30-minute background refreshes would have used up the monthly quota in about a day.

## [1.3.0] - 2026-11-08

### Added
- `ODDS_PROVIDER` setting: `theoddsapi` (primary), `espn` (keyless DraftKings only) or `auto`. If `theoddsapi` is set without `ODDS_API_KEY`, the server falls back to ESPN and the Odds screen and `/api/odds/status` show a warning.
- Reverse line movement (estimated): flags game lines that moved 2.5%+ implied (about a point) since open toward the underdog or under, backed by most books with history. Shown as an RLM badge, a Line movement panel and a new `reverse_move` alert type. The providers don't publish public ticket/handle splits, so the favorite and the over are treated as the public side.
- EV confidence rating (0–100 with reasons) based on sharp reference vs consensus, number of books, price freshness, odds length, prop status and edge size. Shown in the +EV scanner.
- Worst available price per selection, alongside the best price.
- Market range history: a new `odds_selection_history` table records best/worst price, market average and fair value whenever they change. The line history drawer adds a "Best vs worst" chart.
- Sportsbook comparison adds Edge and EV columns. The worst price shows on hover over Best.
- "Props only" filter toggle.
- `GET /api/odds/props` (alias of `/api/odds/player-props`). `/api/odds/history` returns `range`, `/api/odds/movement` returns `reverse`.
- Versioned SQL migrations: numbered files in `backend/src/db/migrations`, applied once in order inside a transaction, checksummed in `schema_migrations`, guarded by an advisory lock. Run on API startup and via `npm run db:migrate`. CI applies them.
- Browser tab icon (fixes the `favicon.ico` 404).

### Changed
- `odds.aggregate.service.ts` is renamed to `oddsAggregator.service.ts`.
- docker-compose passes `ODDS_PROVIDER` (default `theoddsapi`).

### Fixed
- `docs/API.md` listed the old Market Lab paths (`/odds`, `/odds/movement`) instead of `/odds/scan` and `/odds/snapshots`.

## [1.2.0] - 2026-11-08

### Added
- Real-time odds intelligence platform replacing the basic Odds Screen: dashboard metrics, a market board (current/opening odds, line move, best price, market average, implied and no-vig model probability, EV, arbitrage, Kelly and recommended stake), sportsbook comparison / line shopping, per-game drawer with every market, line-movement history charts, steam and sharp-money signals, +EV scanner (positive/strong/elite tiers with risk ratings), arbitrage scanner with stake sizing, player prop screener with L5/L10/season/home/away/opponent hit rates, real-time alerts with custom rules, CLV tracker with automatic closing-price capture, global search, favorite sportsbooks/markets/props and CSV export.
- Odds providers: The Odds API (DraftKings, FanDuel, BetMGM, Caesars, ESPN BET, Fanatics, BetRivers, PrizePicks, Underdog, Pinnacle as the sharp reference) and a keyless ESPN DraftKings fallback. Server polls every 30 seconds while the screen is open and pushes updates over Server-Sent Events.
- New tables: odds_games, odds_markets, odds_lines, odds_history, odds_line_movements, odds_ev_history, odds_arbitrage, odds_refresh_log, odds_alerts, odds_alert_rules, odds_favorites and the odds_player_props view.
- Stats research center under Research → Stats for NBA, NFL, MLB and NHL. It includes league leaders, sortable player tables by position group, and team tables with records, home/away splits, points for/against, offensive/defensive ranks and advanced metrics (NBA ratings and pace, NFL yards per play, MLB OPS and bullpen ERA, NHL special teams).
- Player profiles with bio card, season and form stats, game log, last-5/last-10 performance, home/away and opponent splits, prop research with editable lines and hit rates, trend and career history charts, and generated betting insights.
- Team profiles with scoring trend, splits, recent games, form insights and team leaders.
- Season / last 10 games / last 30 days windows; team, position, conference and division filters; player and team search; CSV export; player and team comparison; favorite players and teams.
- ESPN public stats and MLB Stats API adapters, with a server-side cache (memory plus the `stats_cache` table), a 15-minute background refresh, manual refresh, and stale-data fallback.
- `stats_cache` and `favorite_stats` tables and the matching Prisma models.
- ESLint (`npm run lint`) with TypeScript and React Hooks rules.
- GitHub Actions: CI now runs lint and separate backend/frontend builds on `main`, `develop`, `feature/**` and `fix/**`, then verifies the production Docker images; new `deploy.yml` (GHCR images on `main`, optional host webhook), `release.yml` (GitHub release from the changelog on `vX.Y.Z` tags) and `codeql.yml`.
- Release process docs: `docs/DEVLOG.md`, README environment-variable table and development workflow.

### Changed
- Market Lab's legacy endpoints moved: `GET /api/odds` → `GET /api/odds/scan` and `GET /api/odds/movement` → `GET /api/odds/snapshots`, so `/api/odds` serves the new odds platform. The bundled frontend is updated; external API clients must switch paths.
- docker-compose passes the new `ODDS_*` and `STATS_REFRESH_MINUTES` settings to the backend.

### Fixed
- Two React hook dependency issues that recomputed the dashboard's latest bets and the sportsbook comparison columns on every render.

### Security
- Dependabot weekly updates for npm, GitHub Actions and Docker base images, targeting `develop`.
- CodeQL `security-extended` analysis on `main`, `develop`, pull requests and weekly.
- CI fails if a `.env` file is committed. Provider keys (`ODDS_API_KEY`, `SPORTRADAR_API_KEY`) remain server-side environment variables.

## [1.1.1] - 2026-11-07

### Fixed
- Frontend API requests now use the configured Vite API URL, with network and HTTP failure diagnostics.
- Added LAN frontend origins to the API CORS allowlist and documented phone-on-Wi-Fi setup.
- Prevented local Vite environment files from entering the Docker build context.

## [1.1.0] - 2026-11-07

### Added
- Prisma schema/client for users, bets, bankroll, sportsbooks, favorites, analytics, odds snapshots, and refresh sessions.
- Prisma 7 PostgreSQL driver-adapter setup with an explicit project-local generated client and Prisma config.
- Rotating opaque refresh tokens in HTTP-only cookies with database revocation and 15-minute JWT access tokens.
- React Query remote-data caching and Zustand client auth state.
- Authenticated Excel and PDF report exports alongside CSV; CSV output neutralizes spreadsheet formulas.
- Jest service/API tests and a React component test.
- GitHub Actions CI, API/development/deployment docs, and feature release notes.

### Changed
- Docker backend build now includes Prisma schema/client generation.
- Docker now serves the production frontend through Nginx and prunes development dependencies from the backend image.
- Odds and analysis features are documented as quota-dependent, on-demand research rather than guaranteed predictions.

[Unreleased]: https://github.com/kailutherking/sharpstats-pro/compare/v1.6.0...HEAD
[1.6.0]: https://github.com/kailutherking/sharpstats-pro/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/kailutherking/sharpstats-pro/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/kailutherking/sharpstats-pro/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/kailutherking/sharpstats-pro/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/kailutherking/sharpstats-pro/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/kailutherking/sharpstats-pro/compare/0398248...v1.2.0
