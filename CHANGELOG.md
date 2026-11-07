# Changelog

All notable changes to SharpStats Pro are documented here.

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
