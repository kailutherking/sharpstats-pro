# Release notes

## SharpStats Pro 1.6.1

**Version:** 1.6.1
**Release date:** 2026-11-09

### Features added
- **`TRUST_PROXY` setting** for hosting behind Railway, Render, Vercel or Nginx.
- **Health check** at `/health` now identifies the service: `{ "status": "ok", "service": "sharpstats-backend" }`.

### Bug fixes
- **Railway rate limits:** production requests no longer log `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`. Rate limits now count each visitor separately instead of sharing one bucket for the whole proxy, which could block sign-in for everyone.

### Performance improvements
- None.

### Breaking changes
- None. The `/health` response gained a field; `status` is unchanged.

### Known issues
- **Extra proxy hops:** if a Vercel rewrite forwards API calls to Railway, set `TRUST_PROXY=2`.

## SharpStats Pro 1.6.0

**Version:** 1.6.0
**Release date:** 2026-11-09

### Features added
- **Community:**
  - Share your pending bets as picks, with verified records, reactions (like, fire, lock, tail, fade), comments and share.
  - Tail opens the bet slip pre-filled with the pick.
- **Profiles and follows:** public profiles with your pick record, ROI, units, badges and performance chart. Follow bettors; teams and players you favorite in Stats now power injury alerts and your feed.
- **Activity feed:** picks, big wins, injury news, sharp line moves and headlines in one place.
- **Leaderboards:** global and friends, by units, ROI, win rate, props and sportsbook.
- **Badges, XP, levels and daily streaks** that reward research habits.
- **Notification center:** prop hits, bet results, injury updates, line moves, EV, arbitrage, new followers and activity on your picks, delivered live. Turn each type on or off in Settings.
- **Live game room:** chat, emoji reactions on the game and on individual plays, and your bets on that game tracked live.
- **Mobile:** a bottom navigation bar and a setup checklist for new accounts.

### Bug fixes
- The notification bell was a placeholder; it now shows real notifications.

### Performance improvements
- Feeds and leaderboards are single SQL queries. Headlines are cached for 10 minutes. Live updates arrive by push instead of polling.

### Breaking changes
- None. The new tables are created by migration `003` on startup.

### Known issues
- **Leaderboards and pick lists need users:** they fill in as people share picks, and rate leaderboards need 5–10 settled picks per bettor.
- **Verified records** need bets logged from the Odds screen (so start times are known) and automatic grading.
- **No avatar uploads:** profile photos are HTTPS URLs for now.
- **Not yet built:** groups/circles, web push, email digests, a dedicated news hub and a trade feed (see the roadmap in `docs/REAL_COMPETITIVE_ANALYSIS.md`).
- **Real-time** uses Server-Sent Events rather than WebSockets (see the realtime plan in the same doc).

## SharpStats Pro 1.5.0

**Version:** 1.5.0
**Release date:** 2026-11-09

### Features added
- **Live Game Tracker** (Stats → Live games):
  - NBA, NFL, MLB and NHL games updating every 15 seconds: score, clock, period or inning, possession, game status, win probability and live moneyline, spread and total.
  - Sport-specific detail: NBA timeouts and fouls; NFL down, distance and red zone; MLB count, outs, base runners and pitcher/batter; NHL shots and power plays.
  - Game view with box score, team stats, leaders, win probability chart, recent plays and a sportsbook comparison (opening, current and closing odds).
- **Live player tracker:** pick any player to see current stats, projected finish and the chance of clearing a prop line.
- **Injury Report** (Research → Injury report):
  - Every listed injury in the four leagues, with filters by team, position, status, update date and search.
  - Betting impact ratings for each injury, team health scores and a player page with history, news, practice participation and workload notes.
- **Odds impact:** see how a team's spread has moved since a key player's report. Injury alerts (ruled out, upgrades, downgrades, returns, line movement) appear in the Odds screen alert feed, and the Odds screen has a new "Injury impact" tab.

### Bug fixes
- None.

### Performance improvements
- Live and injury data are cached server-side (10 seconds and 5 minutes), so many open screens share one provider call.
- The live tracker never triggers extra paid odds refreshes. After a restart it shows ESPN's DraftKings line until the next scheduled refresh.

### Breaking changes
- None. The new database tables are created automatically by migration `002` on startup.

### Known issues
- **Impact ratings are estimates:** they're rules of thumb based on season statistics, not a trained model.
- **Spread movement after a report is correlation, not proof** the injury caused it. Reports older than line tracking are compared with the first tracked line instead.
- **Injury history starts with this release:** it shows the status changes SharpStats records from now on, plus ESPN's latest notes.
- **Practice participation and workload limits** are taken from report notes, so they only appear when the notes mention them (mostly NFL).
- **NHL win probability:** ESPN doesn't publish one for the NHL, so it uses the no-vig moneyline.
- **Possession and live lines:** ESPN doesn't publish NBA possession. Once a game starts, ESPN's line is DraftKings' closing line; in-game prices come from the multi-book board on its credit-paced schedule.
- **Quarter/period markets and player prop lines** load on request, because each load uses The Odds API credits. Caesars and Fanatics still have no prices from the provider.

## SharpStats Pro 1.4.1

**Version:** 1.4.1
**Release date:** 2026-11-08

### Features added
- **`GET /health` endpoint** for hosting health checks such as Railway. It returns `{ "status": "ok" }`. `/api/health` is unchanged.

### Bug fixes
- If `PORT` is empty or not a number, the API now uses port 4000 instead of failing to start. When the host assigns a port, the API uses it.

### Performance improvements
- None.

### Breaking changes
- None.

### Known issues
- `/health` responds only after database setup finishes on startup, so set the host's health-check timeout long enough for migrations to run.

## SharpStats Pro 1.4.0

**Version:** 1.4.0
**Release date:** 2026-11-08

### Features added
- **Credit pacing for The Odds API:** automatic refreshes are spaced so your plan's credits last until the monthly reset.
  - The league on screen gets the budget first, and background refresh pauses when the budget can't cover it.
  - Manual Refresh always works.
  - On large plans the normal 30-second cadence is unaffected.
- **Restart-safe quota tracking:** the last credit reading and refresh times survive restarts.

### Bug fixes
- The default refresh schedule could use up the 500-credit free plan in about a day.
- In-play games no longer flood alerts with steam, sharp and "+EV" signals caused by books updating at different speeds.

### Performance improvements
- Fewer provider calls: no background refresh when the budget can't afford it, and no refresh burst on restart.

### Breaking changes
- None.

### Known issues
- On the free plan (500 credits/month), a viewed league updates automatically every few hours. Manual Refresh costs about 3 credits per league. Real 30-second updates for one league during about 4 viewing hours a day need roughly 45,000 credits a month.
- As of 2026-11-08, The Odds API returns no Caesars (`williamhill_us`) or Fanatics prices in either US region. Both stay registered and appear automatically if coverage returns. PrizePicks and Underdog only list player props, so they appear on props, not game lines.

Suggested commit message: `feat(odds): pace The Odds API credits and limit signals to pregame markets`

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
