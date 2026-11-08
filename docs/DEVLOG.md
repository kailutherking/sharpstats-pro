# Development log

One entry per completed task, newest first. Commit hashes refer to the feature branch commit; see `git log` for merges.

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
