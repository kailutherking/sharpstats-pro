# Development guide

## Local setup

1. Install Node.js 20+ and PostgreSQL 15+.
2. Copy `.env.example` to `.env`; choose a long random `JWT_SECRET`.
3. Create the database named by `DATABASE_URL`.
4. Run `npm ci`.
5. Apply `backend/src/db/schema.sql` and `backend/src/db/seed.sql` for local PostgreSQL. The API also applies the idempotent SQL schema during startup.
6. Run `npm run prisma:generate --workspace backend`.
7. Run `npm run dev`.

The demo account is `demo@sharpstats.pro` / `SharpStats123!`. Do not reuse demo credentials in any shared or deployed environment.

## Access from a phone on the LAN

Vite reads `frontend/.env.local` automatically when it starts. Set `VITE_API_URL` to this computer's current LAN IPv4 address, for example `http://192.168.1.179:4000/api`, and restart Vite after changing it. Start Vite with `npm run dev --workspace frontend -- --host 0.0.0.0 --port 5175`; open `http://<computer-LAN-IP>:5175` on the phone. The API's development CORS allowlist includes the localhost and LAN origins on ports 5173, 5175, and 5177. Update the local API URL if the router changes this computer's address.

## Architecture

- React Query owns cached remote data; Zustand owns client authentication state.
- The Express API validates JSON at the boundary with Zod, issues short-lived JWT access tokens, and rotates HTTP-only refresh cookies.
- Prisma 7 models the relational schema and manages user/refresh-token workflows through the PostgreSQL driver adapter. PostgreSQL parameterized SQL remains in high-volume analytical aggregates and atomic bet/bankroll transactions.
- `backend/prisma.config.ts` loads the database URL for Prisma CLI commands; the generated client lives in `backend/src/generated/prisma`.
- `backend/src/db/schema.sql` is the idempotent bootstrap/upgrade schema used for the current starter. Keep it aligned with `backend/prisma/schema.prisma` when changing database models.
- Odds platform: providers in `backend/src/providers/theOddsApi.ts` (multi-book, quota-aware, rejects unsupported markets once) and `providers/espnOdds.ts` (keyless DraftKings fallback). The book and market registry is `services/oddsCatalog.ts`; to add a sportsbook, append a `BookDef` or set `ODDS_EXTRA_BOOKS="key|Name|kind"`. Pricing math lives in `services/evCalculator.service.ts`, grouping/no-vig/arbitrage in `services/odds.aggregate.service.ts`, movement/steam in `services/lineMovement.service.ts`, arbitrage history in `services/arbitrage.service.ts`, alerts in `services/oddsAlerts.service.ts`, prop hit rates in `services/propResearch.service.ts`, the SSE hub in `services/oddsStream.ts`, and orchestration, scheduler and caching in `services/odds.service.ts`. Routes: `routes/odds.routes.ts` and `controllers/odds.controller.ts`. UI: `frontend/src/pages/OddsPage.tsx` and `frontend/src/components/odds/`.
- Stats research center: `backend/src/providers/espnStats.ts` (ESPN/MLB Stats API adapters and normalizers), `services/statsMetrics.ts` (per-league stat, leader, prop and team-metric definitions), `services/statsInsights.ts` (hit rates, splits and insight engine; pure and unit-tested), `services/statsCache.ts` (memory plus `stats_cache` table, stale fallback), and `services/stats.service.ts` (league datasets, form windows, profiles, favorites, 15-minute scheduler). Routes are in `routes/stats.routes.ts` and `controllers/stats.controller.ts`; the UI is `frontend/src/pages/StatsPage.tsx` and `frontend/src/components/stats/`. To add a stat, add a `MetricDef` in `statsMetrics.ts` and reference it from a group's `columns` or `leaders`.
- Provider keys are server-side only. Sample data is confined to the demo seed and is not presented as live market pricing.

## Verification

```sh
npm run prisma:generate --workspace backend
npm test
npm run typecheck
npm run build
npm audit --audit-level=high
```

Tests cover calculation services, API health/auth boundaries, and a React component. Add regression tests for new routes and result calculations.

## Feature release checklist

1. Add implementation and tests.
2. Update `CHANGELOG.md` and the relevant README/API docs.
3. Update root and workspace package versions using SemVer.
4. Add a dated entry to `RELEASE_NOTES.md`.
5. Run test, typecheck, build, and dependency audit.
6. Use a suggested commit title such as `feat(market): add multi-book EV scanner`.
