# Changelog

All notable changes to SharpStats Pro are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/kailutherking/sharpstats-pro/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/kailutherking/sharpstats-pro/compare/0398248...v1.2.0
