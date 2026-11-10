# SharpStats Pro

A responsive sports betting research and bankroll management starter. It includes a React/TypeScript dashboard, Express API, PostgreSQL persistence, JWT authentication with rotating refresh tokens, CSV/Excel/PDF reports, a demo account, and provider adapter examples. Live odds require a configured provider key; without one, market scanners report that live data is unavailable.

The Market Lab adds multi-book no-vig market estimates, player-prop boards, EV and arbitrage scans, per-user odds calibration, manual line-history snapshots, fractional-Kelly portfolio caps, and provider-assisted grading. These research tools do not claim independent predictions or guaranteed opportunities when data is missing.

The Stats research center (Research → Stats) covers current-season NBA, NFL, MLB and NHL statistics: league leaders, sortable player and team tables, team records, home/away splits, offensive and defensive ranks, advanced team metrics, player profiles with game logs, splits, trend and history charts, prop hit-rate research, and auto-generated betting insights. It also includes CSV export, player/team comparison and favorites. Data comes from ESPN's public stats feeds and the MLB Stats API (no key required), is cached server-side, and refreshes every 15 minutes.

The Odds Screen (Research → Odds screen) is a real-time sportsbook market board for NBA, NFL, MLB and NHL: line shopping across DraftKings, FanDuel, BetMGM, Caesars, ESPN BET, Fanatics, BetRivers, PrizePicks and Underdog; opening/current/peak prices and best/worst price with history charts; steam, sharp and (estimated) reverse line movement plus biggest movers; no-vig fair odds, +EV scanner with edge and a 0–100 confidence rating, arbitrage scanner; player prop hit rates; live alerts and a CLV tracker. Set `ODDS_API_KEY` ([The Odds API](https://the-odds-api.com)) for full multi-book coverage; without it, DraftKings game lines load from ESPN's public feed.

The Live Game Tracker (Research → Stats → Live games) follows today's NBA, NFL, MLB and NHL games every 15 seconds: score, clock, period or inning, possession, game status (pregame, live, halftime, end of quarter/period, final), win probability and live moneyline, spread and total. Sport-specific panels cover NBA timeouts and team fouls, NFL down and distance with a red-zone flag, MLB balls, strikes, outs, base runners and pitcher/batter, and NHL shots and power plays. Each game has team stats, leaders, a full box score, a win probability chart, a sportsbook comparison with opening, current and closing odds, and a live player tracker that projects each player's finish and the chance of clearing a prop line. Data comes from ESPN's public game feeds and the NHL's official API (no key); sportsbook prices come from the Odds screen.

The Injury Report (Research → Injury report) lists every injury for the four leagues from ESPN's injury feeds, refreshed every 5 minutes, with filters by team, position, status, update date and search. Each injury gets a betting impact estimate (importance, team rating and win probability change, offensive, defensive, fantasy and prop impact, and teammates likely to gain usage), team health scores, a player page with history, news, practice participation and workload notes, and the spread movement on the team's next game since the report. Status changes raise alerts (ruled out, upgraded, downgraded, returning, line movement) in the Odds screen's alert feed.

Community (Workspace → Community) adds a social layer around the research tools without replacing them. You can share pending tracked bets as picks; they're locked if shared before the game and verified when graded from the final score. Picks get likes, fire, lock, tail and fade reactions and comments. There are public profiles with records from shared picks (sizes in units, never dollars), follows, an activity feed (picks, big wins, injury news for players and teams you follow, sharp line moves, headlines) and leaderboards (ROI, win rate, units, props, sportsbooks). Badges, XP, levels and a daily streak reward research habits. A live notification center covers prop hits, injuries, line moves, EV, arbitrage and activity on your picks. Live games get a chat room, reactions on plays and a tracker for your own bets. See [docs/REAL_COMPETITIVE_ANALYSIS.md](./docs/REAL_COMPETITIVE_ANALYSIS.md) for the competitive analysis and roadmap.

> SharpStats Pro is an analytics tool, not financial advice or a guarantee of results. Validate all odds and wager information with your sportsbook. Bet responsibly.

## Requirements

- Node.js 20+
- npm 10+
- Docker Desktop (recommended), or PostgreSQL 15+

## Start with Docker

1. Copy `.env.example` to `.env`. Set `JWT_SECRET` to a unique random value before exposing the app beyond local development.
2. From the project root run `docker compose up --build`.
3. Open [http://localhost:5173](http://localhost:5173).
4. Sign in with `demo@sharpstats.pro` / `SharpStats123!`.
5. API health check: [http://localhost:4000/health](http://localhost:4000/health) (also at `/api/health`).

The database schema, pending migrations (`backend/src/db/migrations`) and example sportsbooks are applied automatically on API startup; `npm run db:migrate --workspace backend` runs them on demand. The demo user and sample bets are created on the first successful API start. To reseed a fresh local database, run `docker compose down -v` and start it again (this removes local database data).

## Start without Docker

1. Create a PostgreSQL database, run `npm run db:migrate --workspace backend` (with `DATABASE_URL` set), then apply `backend/src/db/seed.sql`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, a unique `JWT_SECRET` (at least 24 characters), and `CLIENT_ORIGIN`.
3. Run `npm ci` from the root, `npm run prisma:generate --workspace backend`, then `npm run dev`.
4. Visit the frontend at port 5173 and use the demo credentials above.

To test on a phone on the same Wi-Fi, set `VITE_API_URL` in the ignored `frontend/.env.local` to `http://<computer-LAN-IP>:4000/api`, start Vite with `npm run dev --workspace frontend -- --host 0.0.0.0 --port 5175`, and open `http://<computer-LAN-IP>:5175` on the phone. See the [LAN development guide](./docs/DEVELOPMENT.md#access-from-a-phone-on-the-lan).

## Project structure

```text
backend/
  src/
    db/                 PostgreSQL baseline schema, numbered migrations, migration runner and seed data
    controllers/        Request validation and response mapping (odds platform)
    middleware/         JWT auth and request error handling
    providers/          The Odds API, ESPN odds/stats, MLB Stats API and Sportradar adapters
    routes/             Auth, bets, analytics, bankroll, odds, stats, profile
    services/           Odds aggregation, line movement, EV, arbitrage, alerts, stats and app logic
    app.ts              Express application and route wiring
    server.ts           Process startup and graceful shutdown
frontend/
  src/
    components/         Shared layout, cards and charts; odds/ and stats/ feature components
    lib/                API client, typed models, formatters and the live odds stream hook
    pages/              Odds and Stats workspaces
    App.tsx             Auth gate and app navigation
    index.css           Tailwind theme and global styles
```

## Environment variables

Copy `.env.example` to `.env`. Secrets stay in `.env`, which git ignores; never commit real keys.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | local Postgres | PostgreSQL connection string |
| `JWT_SECRET` | — | Access-token signing secret (24+ characters, unique per environment) |
| `JWT_EXPIRES_IN` | `15m` | Access-token lifetime |
| `PORT` / `CLIENT_ORIGIN` | `4000` / `http://localhost:5173` | API port (hosts such as Railway set `PORT` automatically) and allowed browser origin |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | demo account | Local demo login; replace for deployments |
| `ODDS_PROVIDER` | `auto` (`.env.example`: `theoddsapi`) | `theoddsapi` (primary), `espn` (keyless DraftKings only) or `auto` (The Odds API when a key is set). `theoddsapi` without a key falls back to ESPN and shows a warning |
| `ODDS_API_KEY` | empty | The Odds API key; enables every sportsbook, period/alternate markets, props, EV and arbitrage |
| `ODDS_REFRESH_SECONDS` | `30` | Refresh interval while the odds screen is open |
| `ODDS_BACKGROUND_REFRESH_MINUTES` | `30` | Refresh interval with no viewers (`0` disables) |
| `ODDS_SHARP_BOOK` | `pinnacle` | Reference book for fair prices and sharp moves |
| `ODDS_MIN_CREDITS` | `250` | Below this many provider credits, refreshes slow to every 10 minutes |
| `ODDS_CREDIT_PACING` | `true` | Stretch automatic refreshes so remaining credits (less a 20% reserve for manual refreshes, drawers and props) last until the reset; background refresh pauses when the budget can't cover it |
| `ODDS_CREDITS_RESET_DAY` | `1` | Day of the month (UTC) your The Odds API quota resets |
| `ODDS_EXTRA_BOOKS` | empty | Extra books as `key\|Name\|kind`, comma-separated |
| `SPORTRADAR_API_KEY` | empty | Sportradar schedule adapter example |
| `STATS_REFRESH_MINUTES` / `STATS_AUTO_REFRESH` | `15` / `true` | Stats cache refresh |
| `STATS_PROVIDER_TIMEOUT_MS` | `20000` | Stats and injury provider request timeout |
| `LIVE_PROVIDER_TIMEOUT_MS` | `12000` | Live game provider request timeout |
| `INJURY_REFRESH_MINUTES` | `5` | Injury report refresh interval (also the background sync that raises injury alerts) |
| `NHL_API_URL` | `https://api-web.nhle.com` | NHL official API (power-play situations) |
| `VITE_API_URL` | current host | Frontend API base URL (build time) |

## Development workflow

- Branches: `main` is production, `develop` is active development, and work happens on `feature/*` or `fix/*` branches merged into `develop`.
- Checks: `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` from the root. CI runs all of them, plus Docker image builds and `npm audit`, on every push and pull request.
- Releases follow [Semantic Versioning](https://semver.org). Update `CHANGELOG.md`, `RELEASE_NOTES.md` and `docs/DEVLOG.md`, merge `develop` into `main`, then push a `vX.Y.Z` tag that matches `package.json`. The release workflow publishes the GitHub release and versioned images to GitHub Container Registry.
- GitHub automation: `ci.yml`, `deploy.yml` (publishes images on `main`; set the `DEPLOY_WEBHOOK_URL` secret and `VITE_API_URL` variable to deploy), `release.yml`, `codeql.yml` and Dependabot (weekly npm, Actions and Docker updates against `develop`).

## Main API

All routes are prefixed with `/api`. Except for auth and health, requests require `Authorization: Bearer <JWT>`.

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `GET|POST /bets`, `GET|PATCH|DELETE /bets/:id`, `POST /bets/import`, `GET /bets/export`
- `GET /analytics/summary`, `GET /analytics/performance`
- `GET|PUT /bankroll`
- `GET /sportsbooks`, `GET /odds/model`, `GET /odds/risk`
- Market Lab: `GET /odds/scan`, `GET /odds/snapshots`
- Odds platform: `GET /odds`, `/odds/live`, `/odds/movement`, `/odds/arbitrage`, `/odds/ev`, `/odds/props` (alias `/odds/player-props`), `/odds/sportsbooks`, `/odds/history`, `/odds/game/:id`, `/odds/search`, `/odds/clv`, `/odds/status`, `/odds/stream` (Server-Sent Events), `POST /odds/refresh`, `GET|POST|PATCH|DELETE /odds/alerts/rules`, `GET /odds/alerts`, `GET|PUT /odds/favorites` (full table in [docs/API.md](./docs/API.md))
- `POST /bets/grade` (moneyline, spread, and total scores when supported provider results are available)
- `GET|PUT /profile`
- `GET /stats/:league` (`nba`, `nfl`, `mlb`, `nhl`), `POST /stats/:league/refresh`, `GET /stats/player/:id`, `GET /stats/team/:id`, `GET|PUT /stats/favorites`
- Live games: `GET /live-games`, `GET /live-games/:id`, `GET /live-games/player/:id`
- Injuries: `GET /injuries`, `GET /injuries/player/:id`, `GET /injuries/team/:id`, `GET /injuries/impact`
- Community: `GET|PUT /social/me`, `/social/profiles/:handle`, `PUT /social/follows/:handle`, `/social/feed`, `/social/picks`, `/social/posts/:id` (reactions, comments), `/social/leaderboards`, `/social/achievements`
- Notifications and realtime: `GET /notifications`, `POST /notifications/read`, `GET|PUT /notifications/preferences`, `GET /realtime/stream` (Server-Sent Events); live game chat: `/live-games/:id/chat`, `/live-games/:id/reactions`, `/live-games/:id/my-bets`

The Market Lab normalizes The Odds API prices across books, calculates no-vig consensus probabilities, identifies positive expected value and theoretical arbitrage, and records line snapshots for movement comparisons. Line movement history accrues on explicit scans (up to six scans per minute; snapshots are retained for 30 days). Player props are optional because provider market availability and API quotas vary. Configure `ODDS_API_KEY` in `.env` for current odds, historical snapshots, and supported score-based grading. Configure `SPORTRADAR_API_KEY` for the separate Sportradar schedule adapter example. Provider requests are made server-side so keys are not exposed in the browser. Review each provider's API plan, terms, and rate limits before use.

The personal odds-calibration model is a regularized logistic regression trained on a user's settled bet outcomes and odds. It remains disabled until there are at least 50 settled decisions; it calibrates odds, not player statistics or independent game features. Consensus probabilities require paired outcomes from multiple books. Score-based grading supports moneyline, spread, and totals when a matching completed event is returned by The Odds API; player props and unmatched events remain pending for manual grading. Kelly stake suggestions are fractional and portfolio-capped, not guarantees.

## Notes

- The demo account is deliberately local-only sample data. Replace the demo credentials and use a managed secret store for deployed environments.
- Access JWTs are held in browser local storage; rotating refresh tokens are hash-stored in PostgreSQL and delivered through HTTP-only, same-site cookies. For a public deployment, use TLS, review the browser token threat model, and add operational monitoring.
- Bet result accepts `pending`, `win`, `loss`, and `push`. Profit/loss is calculated on the server from decimal odds and stake; entering a result updates the bankroll.
- CSV import accepts rows with `sport`, `league`, `event`, `bet_type`, `team_player`, `odds`, `stake`, `sportsbook`, `date`, `result`, and `notes` headers. The importer validates each row and reports skipped rows.
- Prisma 7 models core persistence and uses the PostgreSQL driver adapter; analytics and bet transactions retain parameterized PostgreSQL SQL. `backend/src/db/schema.sql` is the baseline; later changes are numbered migrations in `backend/src/db/migrations`. Both must stay aligned with the Prisma schema.
- See [API documentation](./docs/API.md), [development guide](./docs/DEVELOPMENT.md), [deployment guide](./docs/DEPLOYMENT.md), [changelog](./CHANGELOG.md), and [release notes](./RELEASE_NOTES.md).
