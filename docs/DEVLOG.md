# Development log

One entry per completed task, newest first. Commit hashes refer to the feature branch commit; see `git log` for merges.

## 2026-11-09 — Community, engagement and notification systems (1.6.0)

- **Feature:** Real-inspired social layer: Community page (feed, picks, leaderboards, profiles), follows, reactions and comments, verified picks, badges/XP/levels/streaks, notification center, live game chat and reactions, live bet tracker, mobile bottom navigation, onboarding checklist
- **Description:**
  - **Research:** compared SharpStats with Real Sports using public sources (realapp.com, App Store listing, ScreensDesign teardown); analysis and roadmap are in `docs/REAL_COMPETITIVE_ANALYSIS.md`.
  - **Scope:** built the high-priority items. Groups, push/email, the news hub and the trade feed are on the roadmap. Cards and virtual currency won't be built.
  - **Picks:** only pending bets can be shared, so records can't be padded. Picks snapshot odds and units and are locked/verified from start times and auto-grading.
  - **Privacy:** profiles show only shared picks, never the private bet tracker or dollar stakes.
  - **Follows:** team, player and sportsbook follows reuse existing favorites, which now drive injury notifications and the injury feed.
  - **Notification engine:** 14 types with per-user switches and dedupe keys, fed by alert fan-out, bet settlement, follows, reactions, comments, badges and streaks.
  - **Real-time:** Server-Sent Events (personal stream plus per-game topics) instead of WebSockets. It fits the existing auth and proxy setup and the existing odds streams.
  - **Live bet tracker:** links Odds-screen bets to ESPN games and scans every 60 seconds for prop hits.
  - **Fixes during testing:** a Postgres parameter type conflict in pick settlement; sharing settled bets is now blocked.
  - **Verified:**
    - With a temporary second account (deleted afterwards): follow, tail, comment, notifications, profile record, feed with ESPN headlines, leaderboards.
    - In a live NBA game: chat, reactions and plays.
    - On mobile at 390px: no horizontal scrolling.
- **Files changed:**
  - **New backend:** `services/social/*` (realtime, notification, profile, pick, feed, leaderboard, gamification, liveChat, liveBetTracker, alertFanout, maintenance, tests), `routes/social.routes.ts`, `routes/notifications.routes.ts`, `routes/realtime.routes.ts`, `db/migrations/003_social_engagement.sql`.
  - **New frontend:** `pages/CommunityPage.tsx`, `components/social/*`, `components/live/LiveGameChat.tsx`, `lib/socialTypes.ts`, `lib/useRealtime.ts`, `lib/navStore.ts`, a test.
  - **Modified:** `app.ts`, `server.ts`, `routes/bets.ts`, `routes/liveGame.routes.ts`, `services/grading.ts`, `services/oddsAlerts.service.ts`, `services/liveGame.service.ts`, Prisma schema, `App.tsx`, `StatsPage.tsx`, `LiveGamesPage.tsx`, `OddsPage.tsx`, `api.ts`, test icon mock, README, API docs, CHANGELOG, RELEASE_NOTES, versions.
- **Commit hash:** 8f9ec04
- **Version:** 1.6.0

## 2026-11-09 — Live game tracker and injury intelligence center (1.5.0)

- **Feature:** Live Game Tracker (Stats → Live games), live player prop tracker, Injury Report page, injury impact model, team health, injury alerts and odds impact
- **Description:**
  - **Data sources:** ESPN scoreboard and summary feeds (scores, situations, box scores, win probability, DraftKings open/close) and the NHL official API (power plays).
  - **Live tracker:** 15-second refresh, linked to the multi-book odds board. Opening and current prices come from the board; closing prices come from `odds_history`.
  - **Player tracker:** projected finish (season rate blended with in-game pace, minute-based for the NBA) and hit probability (Poisson or normal model).
  - **Injury report:** ESPN injury feeds for four leagues with a rules-based impact model (team rating change against a replacement-level player, scaled by status), team health scores, and practice and workload notes taken from report text.
  - **Odds impact:** spread at the report time vs. now, falling back to the first tracked line for older reports.
  - **Alerts:** status-change and line-correlation alerts raised from a 5-minute background sync.
  - **Credits:** the live tracker reuses ESPN lines after a restart, so it never buys extra The Odds API refreshes.
  - **Verified live (Nov 9):**
    - NBA games in progress: clock, timeouts, fouls, ESPN win probability, box score and player projections.
    - Earlier finished NFL games: box score, leaders, plays and DraftKings open/close.
    - Injury reports for all four leagues.
- **Files changed:**
  - **New backend:** `providers/espnLive.ts`, `providers/espnInjuries.ts`, `services/liveGame.service.ts`, `services/injury.service.ts`, `services/injuryImpact.service.ts`, `controllers/liveGame.controller.ts`, `controllers/injury.controller.ts`, `routes/liveGame.routes.ts`, `routes/injury.routes.ts`, `db/migrations/002_live_games_injuries.sql`, plus tests.
  - **New frontend:** `pages/LiveGamesPage.tsx`, `pages/InjuryReportPage.tsx`, `components/live/*`, `components/injuries/*`, `lib/liveTypes.ts`, `lib/injuryTypes.ts`, plus a test.
  - **Modified:** `app.ts`, `server.ts`, `odds.service.ts`, `oddsAlerts.service.ts`, the Prisma schema, `App.tsx`, `StatsPage.tsx`, `OddsPage.tsx`, `AlertsPanel.tsx`, `api.ts`, `oddsTypes.ts`, docs, `.env.example`, `docker-compose.yml`, versions.
- **Commit hash:** c835606
- **Version:** 1.5.0

## 2026-11-08 — Railway port and /health endpoint (1.4.1)

- **Feature:** Host-assigned port and a platform health check
- **Description:** The API listens on `Number(process.env.PORT) || 4000`, so Railway's assigned port is used and an empty or invalid value falls back to 4000. Added `GET /health` returning `{ "status": "ok" }` (`/api/health` kept). Added a Railway section to the deployment guide. Verified by starting the server with `PORT=8080`: it logged "SharpStats API listening on 8080" and both health routes returned `{"status":"ok"}`.
- **Files changed:** `backend/src/server.ts`, `backend/src/app.ts`, `backend/src/app.test.ts`, `README.md`, `docs/DEPLOYMENT.md`, `CHANGELOG.md`, `RELEASE_NOTES.md`, `package.json` ×3, `package-lock.json`
- **Commit hash:** 3647a30
- **Version:** 1.4.1

## 2026-11-08 — Credit pacing and pregame-only signals (1.4.0)

- **Feature:** The Odds API credit pacing; signals and alerts limited to pregame markets
- **Description:** Connected the user's The Odds API key (free plan, 500 credits/month) and verified live: NFL and NBA boards with DraftKings, FanDuel, BetMGM, ESPN BET, BetRivers and Pinnacle. The default 30s/30min schedule would have used up the quota in about a day, so added credit pacing: viewed leagues first, background paused when unaffordable, a 20% reserve, and quota and refresh times restored on restart. Live NFL games produced most +EV, steam and alert noise, so signals and alerts now cover only games not yet started, and in-play confidence drops by 30. Found that The Odds API currently has no Caesars or Fanatics prices in the us/us2 regions.
- **Files changed:** new `backend/src/services/creditPacing.ts` and `creditPacing.test.ts`; modified `odds.service.ts`, `oddsAggregator.service.ts`, `oddsAlerts.service.ts`, `evCalculator.service.ts`, `theOddsApi.ts`, `odds.routes.ts`, `oddsSignals.test.ts`, `frontend/src/lib/oddsTypes.ts`, `frontend/src/pages/OddsPage.tsx`, `.env.example`, `docker-compose.yml`, README, `docs/API.md`, CHANGELOG, RELEASE_NOTES, `package.json` ×3, `package-lock.json`
- **Commit hash:** ee34145
- **Version:** 1.4.0

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
