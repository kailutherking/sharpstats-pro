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

## Architecture

- React Query owns cached remote data; Zustand owns client authentication state.
- The Express API validates JSON at the boundary with Zod, issues short-lived JWT access tokens, and rotates HTTP-only refresh cookies.
- Prisma 7 models the relational schema and manages user/refresh-token workflows through the PostgreSQL driver adapter. PostgreSQL parameterized SQL remains in high-volume analytical aggregates and atomic bet/bankroll transactions.
- `backend/prisma.config.ts` loads the database URL for Prisma CLI commands; the generated client lives in `backend/src/generated/prisma`.
- `backend/src/db/schema.sql` is the idempotent bootstrap/upgrade schema used for the current starter. Keep it aligned with `backend/prisma/schema.prisma` when changing database models.
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
