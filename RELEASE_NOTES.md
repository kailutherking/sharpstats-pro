# Release notes

## SharpStats Pro 1.1.0 — 2026-11-07

This release adds production-oriented authentication and application scaffolding to the market research platform. Sessions now use short-lived JWTs and rotating, hash-stored refresh tokens delivered through HTTP-only cookies. Prisma 7 models the core relational schema through the PostgreSQL driver adapter, while React Query and Zustand handle server-cache and client-auth state.

Bet history can now be exported as CSV, Excel, or PDF. The CSV exporter protects spreadsheet users from formula injection. Automated tests, CI checks, API/deployment documentation, and production Docker images are included.

Odds scanning remains provider-dependent and request-driven. This release does not claim independent game/player predictions, real-time guarantees, or guaranteed arbitrage execution.

### Suggested commit messages

- `feat(auth): add rotating refresh-token sessions`
- `feat(reports): add Excel and PDF bet exports`
- `build(ci): add Jest suites and GitHub Actions checks`
