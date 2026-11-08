# Release notes

## SharpStats Pro 1.3.0

**Version:** 1.3.0
**Release date:** 2026-11-08

### Features added
- **Provider selection:** `ODDS_PROVIDER=theoddsapi` makes The Odds API the primary source for DraftKings, FanDuel, BetMGM, Caesars, ESPN BET, Fanatics, BetRivers, PrizePicks and Underdog, with Pinnacle as the sharp reference. Without a key, the screen falls back to ESPN's DraftKings lines and shows a clear warning.
- **Line movement engine:** adds an estimated reverse line movement flag and alerts, alongside the existing steam moves, sharp-money indicators and biggest movers.
- **+EV scanner:** each edge now has a confidence rating from 0 to 100, with the reasons it was scored that way.
- **Line shopping:** worst price per selection; Edge and EV columns in the sportsbook comparison; a "Best vs worst" history chart with market average and fair value.
- **Filters:** a "Props only" toggle.
- **API:** `/api/odds/props` endpoint.
- **Database:** versioned SQL migrations, starting with `odds_selection_history`.

### Bug fixes
- Fixed outdated Market Lab paths in the API docs.
- Fixed the missing browser tab icon.

### Performance improvements
- Range history is written only when the best price, worst price or fair value changes, in batches of up to 500 rows.

### Breaking changes
- None. `/api/odds/player-props` still works alongside `/api/odds/props`.

### Known issues
- `ODDS_API_KEY` is still required for multi-book coverage. Without it, only DraftKings lines are available, and EV, arbitrage, props and the sharp reference stay inactive. The Odds API path is covered by fixture tests and has not been verified against a live key.
- Reverse line movement is an estimate: no provider publishes public betting splits. Large moves can also come from injury or lineup news.
- PointsBet remains retired (Fanatics, 2024). ESPN BET depends on The Odds API's coverage.

Suggested commit message: `feat(odds): add provider selection, reverse line movement, EV confidence and best/worst line history`

## SharpStats Pro 1.2.0

**Version:** 1.2.0
**Release date:** 2026-11-08

### Features added
- **Odds intelligence platform** (Research → Odds screen) for NBA, NFL, MLB and NHL:
  - market board with current/opening/best prices, market average, no-vig probability, EV, arbitrage, Kelly and recommended stake
  - line shopping across DraftKings, FanDuel, BetMGM, Caesars, ESPN BET, Fanatics, BetRivers, PrizePicks and Underdog
  - line-movement charts with steam and sharp-move signals
  - +EV and arbitrage scanners
  - player prop screener with L5/L10/season/home/away/opponent hit rates
  - live alerts with custom rules, a CLV tracker, global search, favorites and CSV export
  - 30-second refresh while open and live push updates over Server-Sent Events
- **Stats research center** (Research → Stats): league leaders, player and team tables, player and team profiles, splits, prop hit-rate research, trend charts, comparison and favorites. Data comes from ESPN and the MLB Stats API; no key is needed.
- **Release tooling:** ESLint, expanded CI, and new deploy, release, CodeQL and Dependabot automation.

### Bug fixes
- Fixed React hook dependencies that recomputed the dashboard's latest bets and the sportsbook comparison columns on every render.

### Performance improvements
- Odds refresh is demand-driven: every 30 seconds while someone is viewing, every 30 minutes otherwise, and slower when provider credits run low.
- Game and prop markets are fetched only when opened, then cached for 2–3 minutes.
- Stats responses are cached in memory and in PostgreSQL, with a stale-data fallback.

### Breaking changes
- Market Lab API paths changed: `GET /api/odds` → `GET /api/odds/scan`, and `GET /api/odds/movement` → `GET /api/odds/snapshots`. The bundled frontend is updated. Only external API clients are affected. Because the REST API is consumed only by the bundled frontend, this ships as a minor release.

### Known issues
- Without `ODDS_API_KEY`, only DraftKings full-game lines (from ESPN) are available. Other books, period and alternate markets, props, no-vig EV and arbitrage need the key. The Odds API integration is covered by fixture tests and has not been verified against a live key yet.
- Public betting percentages are not offered by the configured providers. The screen says so instead of estimating them.
- PointsBet is listed as retired (acquired by Fanatics in 2024). ESPN BET prices depend on what The Odds API still returns.
- Some prop markets (NBA minutes, NHL saves %, fantasy scores) may be rejected by The Odds API. They are marked "not offered" automatically.
- `npm audit` reports 28 low/moderate advisories, mostly through `exceljs` → `uuid`. None are high or critical.

Suggested commit message: `feat: add real-time sportsbook odds intelligence platform with line movement, player props, EV scanning, and arbitrage tracking`

## SharpStats Pro 1.1.1 — 2026-11-07

Fixes local-network frontend connectivity: the API base URL uses `VITE_API_URL` or the current browser host, failed requests log useful diagnostics, and Express permits the documented LAN development origins. Vite environment files remain local and excluded from Docker contexts.

Suggested commit message: `fix(connectivity): support LAN frontend API access`

## SharpStats Pro 1.1.0 — 2026-11-07

This release adds production-oriented authentication and application scaffolding to the market research platform. Sessions now use short-lived JWTs and rotating, hash-stored refresh tokens delivered through HTTP-only cookies. Prisma 7 models the core relational schema through the PostgreSQL driver adapter, while React Query and Zustand handle server-cache and client-auth state.

Bet history can now be exported as CSV, Excel, or PDF. The CSV exporter protects spreadsheet users from formula injection. Automated tests, CI checks, API/deployment documentation, and production Docker images are included.

Odds scanning remains provider-dependent and request-driven. This release does not claim independent game/player predictions, real-time guarantees, or guaranteed arbitrage execution.

### Suggested commit messages

- `feat(auth): add rotating refresh-token sessions`
- `feat(reports): add Excel and PDF bet exports`
- `build(ci): add Jest suites and GitHub Actions checks`
