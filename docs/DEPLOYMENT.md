# Deployment guide

## Docker Compose

1. Set a unique `JWT_SECRET` and provider keys in `.env`.
2. Run `docker compose up --build -d`.
3. Verify `/api/health`, then sign in and confirm analytics requests.
4. Back up PostgreSQL and monitor container health/logs.

For production, set `NODE_ENV=production`, terminate TLS at a trusted reverse proxy, set the public `CLIENT_ORIGIN` and browser-reachable `VITE_API_URL` before building the frontend image, rotate keys, and replace the demo password. Refresh cookies are HTTPS-only when `NODE_ENV=production`. Do not publish PostgreSQL to the public internet.

## CI/CD

- `ci.yml` runs on pushes to `main`, `develop`, `feature/**` and `fix/**`, and on pull requests: lint, Prisma generation, schema apply, tests, type checks, backend and frontend builds, `npm audit --audit-level=high`, and Docker image builds.
- `deploy.yml` runs on `main`: it reruns CI, then publishes `ghcr.io/<owner>/<repo>-backend` and `-frontend` images tagged `latest` and `sha-<commit>`. Set the `VITE_API_URL` repository variable to the public API URL, and the `DEPLOY_WEBHOOK_URL` secret to have your host pull the new images. The job uses the `production` environment, so you can require approval in repository settings.
- `release.yml` runs on `vX.Y.Z` tags: it checks the tag matches `package.json`, creates a GitHub release from that version's `CHANGELOG.md` section, and publishes versioned images.
- `codeql.yml` runs security analysis on `main`/`develop` and weekly; Dependabot opens weekly dependency PRs against `develop`.

## Operational limitations

The starter does not include managed migrations, distributed odds ingestion, queue-based grading, email delivery, or multi-region failover. Move schema changes into reviewed Prisma migrations before a multi-instance deployment. Odds refresh is on-demand and provider quota-limited; it is not an exchange-speed feed. Manual review remains necessary for ambiguous settlements and all player props.
