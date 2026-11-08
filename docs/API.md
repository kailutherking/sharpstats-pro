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

## Stats research center

All stats routes require authentication. `:league` is `nba`, `nfl`, `mlb` or `nhl`. `window` is `season` (default), `last10` or `last30`.

| Method | Path | Description |
|---|---|---|
| GET | `/stats/:league?window=season` | League leaders, player tables by position group, team standings with advanced metrics and offensive/defensive ranks, filter options, `fetchedAt` |
| POST | `/stats/:league/refresh?window=season` | Bypass the cache and re-fetch from the providers |
| GET | `/stats/player/:id?league=nba&window=season` | Bio, season/window stats, game log, prop research metrics, betting insights, home/away and opponent splits, career history |
| GET | `/stats/team/:id?league=nba` | Team metrics, completed games, splits, form insights and team leaders |
| GET | `/stats/favorites` | The user's favorite players and teams across leagues |
| PUT | `/stats/favorites` | `{ league, entityType: "player" \| "team", entityId, name, teamAbbr, imageUrl, favorite }` |

Data comes from ESPN's public stats feeds, plus MLB Stats API relief splits for bullpen ERA. Responses are cached in memory and in the `stats_cache` table for `STATS_REFRESH_MINUTES` (default 15). A background job re-fetches every league on that interval. If a provider fails, the last saved copy is served with `stale: true`. Manual refreshes (`POST .../refresh`, or `refresh=true` on profile routes) are limited to six per minute. `last10`/`last30` form views recalculate stats from game logs for the highest-volume players in each position group. Team tables always use full-season data. NFL EPA and DVOA are not published by these providers and are listed in `unavailableMetrics`. Provider failures with no saved copy return 502.

## Error format

Errors use `{ "error": "..." }`. Validation errors may include a `details` field. Common statuses are 400 (invalid input), 401 (authentication), 404 (not found), 409 (duplicate email), and 429 (rate limit).


## Odds intelligence platform

All routes require a bearer token. `sport` is `nba`, `nfl`, `mlb` or `nhl` (default `nba`). Prices are American odds.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/odds` | Market board: games, selections (every book's price with open/previous/peak/low, implied, no-vig fair, EV, Kelly, arbitrage, steam/sharp signals), dashboard metrics, markets, books, provider status and bankroll sizing. Filters: `category` (`game`, `period`, `team`, `alternate`, `prop`, `all`), `market`, `book`, `date` + `tzOffset`, `q`, `evOnly`, `arbOnly`, `live`, `pregame`, `gameId`, `limit`. |
| GET | `/api/odds/live` | Board restricted to games in progress, plus moves from the last 15 minutes. |
| GET | `/api/odds/game/:id` | Every market for one game (periods, team totals, alternates; `props=true` adds player props). |
| GET | `/api/odds/movement` | Biggest movers since open, steam and sharp signals, and the 24h movement feed (`gameId`, `market`, `hours`). |
| GET | `/api/odds/history` | Change-only price history for one selection (`sideId`, optional `book`). |
| GET | `/api/odds/ev` | +EV prices with no-vig probability, fair odds, EV, edge, Kelly, risk and tier (`minEv` as a fraction, `market`, `book`), plus 24h EV history. |
| GET | `/api/odds/arbitrage` | Open arbitrage with legs, stakes for `total`, guaranteed return and rating, plus recently closed windows. |
| GET | `/api/odds/player-props` | Prop rows (best over/under, books, line move) with hit rates (L5, L10, season, home, away, vs opponent). Filters: `gameId`, `market`, `player`, `team`, `book`, `date`, `type` (`ou`/`yes`). |
| GET | `/api/odds/sportsbooks` | Registry with connection status, favorites and per-sport provider status. |
| GET | `/api/odds/status` | Provider status: mode, connection, last success/error, next refresh, credits remaining. |
| GET | `/api/odds/search?q=` | Global search across games, teams, players, props, markets and sportsbooks. |
| POST | `/api/odds/refresh` | Force a provider refresh (6 per minute). |
| GET | `/api/odds/stream` | Server-Sent Events: `ready`, `update`, `alerts`, `heartbeat`. |
| GET | `/api/odds/alerts` | Alerts from the last `hours` (default 24); `types`, `mine=true` for rule matches. |
| POST / PATCH / DELETE | `/api/odds/alerts/rules[/:id]` | Create, pause/resume and delete custom alert rules. |
| GET / PUT | `/api/odds/favorites` | Favorite markets, props and games. |
| GET | `/api/odds/clv` | Closing line value for your bets (closing CLV and live CLV vs current fair price). |

Refresh: the server polls the provider every `ODDS_REFRESH_SECONDS` (30) while any client has the screen open, otherwise every `ODDS_BACKGROUND_REFRESH_MINUTES` (30, `0` disables). Per-game markets and props are fetched on demand and cached for 2–3 minutes. When The Odds API credits fall below `ODDS_MIN_CREDITS`, refreshes slow to every 10 minutes.
