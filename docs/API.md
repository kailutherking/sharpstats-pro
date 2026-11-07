# SharpStats Pro API

Base URL: `http://localhost:4000/api`. JSON requests use `Content-Type: application/json`. Private endpoints require `Authorization: Bearer <access-token>`. Login/register also set a rotating, HTTP-only `sharpstats_refresh` cookie; send credentials for refresh/logout.

## Authentication

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create user, bankroll, access token, and refresh cookie |
| POST | `/auth/login` | Verify credentials and issue tokens |
| POST | `/auth/refresh` | Rotate refresh cookie and issue a new short-lived access token |
| POST | `/auth/logout` | Revoke refresh token and clear cookie |
| GET | `/auth/me` | Return the authenticated profile |

Refresh tokens are random opaque values stored only as SHA-256 hashes in PostgreSQL. Rotation is atomic; reusing a revoked token is rejected. The browser refresh cookie is HTTP-only, same-site, path-scoped, and secure in production. Access tokens expire after 15 minutes by default.

## Betting and reports

| Method | Path | Description |
|---|---|---|
| GET | `/bets?search=` | List a user's recent bets |
| POST | `/bets` | Validate and create a bet |
| PATCH | `/bets/:id` | Update a bet |
| DELETE | `/bets/:id` | Delete a bet |
| POST | `/bets/import` | Import up to 500 validated rows |
| POST | `/bets/grade` | Grade supported completed events with provider scores |
| GET | `/bets/export` | CSV export |
| GET | `/bets/report/xlsx` | Excel report |
| GET | `/bets/report/pdf` | PDF report |

Bet odds use decimal format. Results are `pending`, `win`, `loss`, and `push`. Winnings are stake × (odds − 1); a loss is −stake; pending and push bets return zero.

## Analytics and odds

| Method | Path | Description |
|---|---|---|
| GET | `/analytics/summary` | Daily/weekly/monthly P/L, ROI, win rate, bankroll, CLV |
| GET | `/analytics/performance` | Grouped league/sport/book/market performance and time series |
| GET/PUT | `/bankroll` | Read/update starting bankroll and unit size |
| GET | `/odds?sport=basketball_nba&includeProps=true` | Provider market prices, no-vig multi-book consensus, EV and arbitrage |
| GET | `/odds/movement` | Per-user historical price snapshots |
| GET | `/odds/model` | Personal odds-calibration model status |
| GET | `/odds/risk` | Open risk and capped portfolio budget |
| GET | `/sportsbooks` | Books with user favorites |
| PUT | `/sportsbooks/:id/favorite` | Set a favorite |
| GET/PUT | `/profile` | Read/update profile |

Market refresh is limited to six requests per minute per user. Historical odds snapshots begin after the first refresh and are retained for 30 days. Provider results, limits, and coverage depend on the configured API subscription.

## Error format

Errors use `{ "error": "..." }`. Validation errors may include a `details` field. Common statuses are 400 (invalid input), 401 (authentication), 404 (not found), 409 (duplicate email), and 429 (rate limit).
