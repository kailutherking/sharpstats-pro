# SharpStats Pro

A responsive sports betting research and bankroll management starter. It includes a React/TypeScript dashboard, Express API, PostgreSQL persistence, JWT authentication with rotating refresh tokens, CSV/Excel/PDF reports, a demo account, and provider adapter examples. Live odds require a configured provider key; without one, market scanners report that live data is unavailable.

The Market Lab adds multi-book no-vig market estimates, player-prop boards, EV and arbitrage scans, per-user odds calibration, manual line-history snapshots, fractional-Kelly portfolio caps, and provider-assisted grading. These research tools do not claim independent predictions or guaranteed opportunities when data is missing.

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
5. API health check: [http://localhost:4000/api/health](http://localhost:4000/api/health).

The database schema and example sportsbooks are initialized and upgraded automatically on API startup. The demo user and sample bets are created on the first successful API start. To reseed a fresh local database, run `docker compose down -v` and start it again (this removes local database data).

## Start without Docker

1. Create a PostgreSQL database and apply `backend/src/db/schema.sql`, then `backend/src/db/seed.sql`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, a unique `JWT_SECRET` (at least 24 characters), and `CLIENT_ORIGIN`.
3. Run `npm ci` from the root, `npm run prisma:generate --workspace backend`, then `npm run dev`.
4. Visit the frontend at port 5173 and use the demo credentials above.

## Project structure

```text
backend/
  src/
    db/                 PostgreSQL schema and sportsbook seed data
    middleware/         JWT auth and request error handling
    providers/          The Odds API and Sportradar adapter examples
    routes/             Auth, bets, analytics, bankroll, odds, profile
    services/           Demo account seeding and application logic
    app.ts              Express application and route wiring
    server.ts           Process startup and graceful shutdown
frontend/
  src/
    components/         Shared layout, cards, and charts
    lib/                API client and typed models
    pages/              Dashboard and product workspaces
    App.tsx             Auth gate and app navigation
    index.css           Tailwind theme and global styles
```

## Main API

All routes are prefixed with `/api`. Except for auth and health, requests require `Authorization: Bearer <JWT>`.

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `GET|POST /bets`, `GET|PATCH|DELETE /bets/:id`, `POST /bets/import`, `GET /bets/export`
- `GET /analytics/summary`, `GET /analytics/performance`
- `GET|PUT /bankroll`
- `GET /sportsbooks`, `GET /odds`, `GET /odds/movement`, `GET /odds/model`, `GET /odds/risk`
- `POST /bets/grade` (moneyline, spread, and total scores when supported provider results are available)
- `GET|PUT /profile`

The Market Lab normalizes The Odds API prices across books, calculates no-vig consensus probabilities, identifies positive expected value and theoretical arbitrage, and records line snapshots for movement comparisons. Line movement history accrues on explicit scans (up to six scans per minute; snapshots are retained for 30 days). Player props are optional because provider market availability and API quotas vary. Configure `ODDS_API_KEY` in `.env` for current odds, historical snapshots, and supported score-based grading. Configure `SPORTRADAR_API_KEY` for the separate Sportradar schedule adapter example. Provider requests are made server-side so keys are not exposed in the browser. Review each provider's API plan, terms, and rate limits before use.

The personal odds-calibration model is a regularized logistic regression trained on a user's settled bet outcomes and odds. It remains disabled until there are at least 50 settled decisions; it calibrates odds, not player statistics or independent game features. Consensus probabilities require paired outcomes from multiple books. Score-based grading supports moneyline, spread, and totals when a matching completed event is returned by The Odds API; player props and unmatched events remain pending for manual grading. Kelly stake suggestions are fractional and portfolio-capped, not guarantees.

## Notes

- The demo account is deliberately local-only sample data. Replace the demo credentials and use a managed secret store for deployed environments.
- Access JWTs are held in browser local storage; rotating refresh tokens are hash-stored in PostgreSQL and delivered through HTTP-only, same-site cookies. For a public deployment, use TLS, review the browser token threat model, and add operational monitoring.
- Bet result accepts `pending`, `win`, `loss`, and `push`. Profit/loss is calculated on the server from decimal odds and stake; entering a result updates the bankroll.
- CSV import accepts rows with `sport`, `league`, `event`, `bet_type`, `team_player`, `odds`, `stake`, `sportsbook`, `date`, `result`, and `notes` headers. The importer validates each row and reports skipped rows.
- Prisma 7 models core persistence and uses the PostgreSQL driver adapter; analytics and bet transactions retain parameterized PostgreSQL SQL. `backend/src/db/schema.sql` remains the current bootstrap/upgrade mechanism and must stay aligned with the Prisma schema.
- See [API documentation](./docs/API.md), [development guide](./docs/DEVELOPMENT.md), [deployment guide](./docs/DEPLOYMENT.md), [changelog](./CHANGELOG.md), and [release notes](./RELEASE_NOTES.md).
