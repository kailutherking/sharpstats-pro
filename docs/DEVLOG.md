# Development log

One entry per completed task, newest first. Commit hashes refer to the feature branch commit; see `git log` for merges.

## 2026-11-08 — Multi-book odds aggregation upgrade (1.3.0)

- **Feature:** Provider selection, reverse line movement, EV confidence, best/worst line history, versioned migrations
- **Description:** Added `ODDS_PROVIDER` (theoddsapi/espn/auto), with an ESPN fallback and an on-screen warning when no key is set. Added estimated reverse line movement (signal, badge, panel and alerts), a 0–100 EV confidence rating, worst price per selection, and Edge/EV columns in the sportsbook comparison. Added a "Props only" filter, the `/api/odds/props` endpoint, and `odds_selection_history` with a best-vs-worst chart. Added versioned SQL migrations (`schema_migrations`, `npm run db:migrate`). Renamed the aggregator to `oddsAggregator.service.ts`. Verified live in keyless mode: NFL board, RLM flags, range history rows and the provider warning.
- **Files changed:** 38. New: `backend/src/db/migrate.ts`, `backend/src/db/migrate.cli.ts`, `backend/src/db/migrations/001_odds_selection_history.sql`, `backend/src/services/oddsSignals.test.ts`, `frontend/public/favicon.svg`. Renamed: `odds.aggregate.service.ts` → `oddsAggregator.service.ts`. Modified: odds, line-movement, EV, alerts and props services; `server.ts`; odds routes; the Prisma schema; odds UI components and types; CI; docker-compose; `.env.example`; README, API and development docs; CHANGELOG; RELEASE_NOTES; the three `package.json` files.
- **Commit hash:** 1df0d5c
- **Version:** 1.3.0

## 2026-11-08 — Release tooling and project history

- **Feature:** Release management (CI/CD, security automation, project history)
- **Description:** Added ESLint (`npm run lint`); expanded CI (lint, separate backend and frontend builds, Docker image verification, `.env` guard) for `main`, `develop`, `feature/**` and `fix/**`; added `deploy.yml` (GHCR images on `main`, optional host webhook), `release.yml` (GitHub release from CHANGELOG on `vX.Y.Z` tags), `codeql.yml` and Dependabot; adopted the `main`/`develop`/`feature/*`/`fix/*` branch model; cut version 1.2.0.
- **Files changed:** `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `.github/workflows/release.yml`, `.github/workflows/codeql.yml`, `.github/dependabot.yml`, `eslint.config.mjs`, `package.json`, `package-lock.json`, `backend/package.json`, `frontend/package.json`, `CHANGELOG.md`, `RELEASE_NOTES.md`, `docs/DEPLOYMENT.md`, `docs/DEVLOG.md`
- **Commit hash:** see the `chore(release): 1.2.0` commit on `develop`
- **Version:** 1.2.0

## 2026-11-08 — Odds intelligence platform and Stats research center

- **Feature:** Real-time odds intelligence platform; Stats research center
- **Description:** Replaced the basic Odds Screen with a market board, line shopping, line-movement history with steam/sharp signals, +EV and arbitrage scanners, prop screener with hit rates, alerts with custom rules, CLV tracker, search, favorites and SSE live updates. Providers: The Odds API (multi-book, Pinnacle reference) and a keyless ESPN DraftKings fallback. Added the Stats research center for NBA, NFL, MLB and NHL from ESPN and the MLB Stats API.
- **Files changed:** 79 files. Backend `controllers/odds.controller.ts`, `routes/odds.routes.ts`, `routes/stats.routes.ts`, `providers/theOddsApi.ts`, `providers/espnOdds.ts`, `providers/espnStats.ts`, `services/odds*.ts`, `services/lineMovement.service.ts`, `services/evCalculator.service.ts`, `services/arbitrage.service.ts`, `services/propResearch.service.ts`, `services/stats*.ts`, `db/schema.sql`, `db/seed.sql`, `prisma/schema.prisma`, `app.ts`, `server.ts`, `routes/odds.ts`; frontend `pages/`, `components/odds/`, `components/stats/`, `lib/odds*`, `lib/stats*`, `lib/sse.ts`, `lib/useOddsStream.ts`, `lib/api.ts`, `App.tsx`, `MarketLab.tsx`, `BetModal.tsx`; docs and `.env.example`, `docker-compose.yml`
- **Commit hash:** c705e30
- **Version:** 1.2.0
