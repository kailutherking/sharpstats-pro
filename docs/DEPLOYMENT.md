# Deployment guide

## Docker Compose

1. Set a unique `JWT_SECRET` and provider keys in `.env`.
2. Run `docker compose up --build -d`.
3. Verify `/api/health`, then sign in and confirm analytics requests.
4. Back up PostgreSQL and monitor container health/logs.

For production, set `NODE_ENV=production`, terminate TLS at a trusted reverse proxy, set the public `CLIENT_ORIGIN` and browser-reachable `VITE_API_URL` before building the frontend image, rotate keys, and replace the demo password. Refresh cookies are HTTPS-only when `NODE_ENV=production`. Do not publish PostgreSQL to the public internet.

## CI/CD

GitHub Actions runs tests, Prisma client generation, type checks, production builds, and dependency audit for pushes to `main` and pull requests. Add deployment credentials as repository secrets and create a separately reviewed deployment job for your hosting provider.

## Operational limitations

The starter does not include managed migrations, distributed odds ingestion, queue-based grading, email delivery, or multi-region failover. Move schema changes into reviewed Prisma migrations before a multi-instance deployment. Odds refresh is on-demand and provider quota-limited; it is not an exchange-speed feed. Manual review remains necessary for ambiguous settlements and all player props.
