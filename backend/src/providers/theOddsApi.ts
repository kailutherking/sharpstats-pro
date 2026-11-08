import { bookByOddsApiKey, getBooks, SPORT_CONFIG, type OddsSport } from "../services/oddsCatalog";
import { americanToDecimal } from "../services/evCalculator.service";
import type { GameStatus, OddsGame, ProviderBoard, ProviderUsage, RawQuote } from "../services/oddsTypes";

/**
 * Client for The Odds API v4 (https://the-odds-api.com). Requests are priced in credits
 * (markets x region-equivalents, where every 10 bookmakers count as one region), so the
 * service layer caches aggressively and this client tracks the quota headers.
 */

const BASE_URL = (process.env.ODDS_API_URL ?? "https://api.the-odds-api.com/v4").replace(/\/+$/, "");
const TIMEOUT_MS = Math.max(2000, Number(process.env.ODDS_PROVIDER_TIMEOUT_MS ?? 15000) || 15000);

export class OddsProviderError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

const usage: ProviderUsage = { remaining: null, used: null, lastCost: null, updatedAt: null };
/** Markets the provider rejected for a sport; skipped on later requests for the process lifetime. */
const rejectedMarkets = new Set<string>();

export function oddsApiConfigured(): boolean {
  return Boolean(process.env.ODDS_API_KEY?.trim());
}

export function oddsApiUsage(): ProviderUsage {
  return { ...usage };
}

export function rejectedMarketKeys(sport: OddsSport): string[] {
  return [...rejectedMarkets].filter((key) => key.startsWith(`${sport}|`)).map((key) => key.slice(sport.length + 1));
}

function bookmakersParam(): string {
  return getBooks().filter((book) => book.oddsApiKey && !book.retired).map((book) => book.oddsApiKey).join(",");
}

function headerNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function call<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.ODDS_API_KEY?.trim();
  if (!key) throw new OddsProviderError("ODDS_API_KEY is not configured", 503, "NOT_CONFIGURED");
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("apiKey", key);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json" } });
  } catch (error) {
    throw new OddsProviderError(`The Odds API is unreachable (${error instanceof Error ? error.name : "network error"})`, 502);
  }
  const remaining = headerNumber(response.headers.get("x-requests-remaining"));
  if (remaining !== null) {
    usage.remaining = remaining;
    usage.used = headerNumber(response.headers.get("x-requests-used"));
    usage.lastCost = headerNumber(response.headers.get("x-requests-last"));
    usage.updatedAt = new Date().toISOString();
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; error_code?: string };
    throw new OddsProviderError(body.message ?? `The Odds API request failed (${response.status})`, response.status, body.error_code);
  }
  return response.json() as Promise<T>;
}

interface ApiOutcome { name: string; description?: string; price: number; point?: number }
interface ApiMarket { key: string; last_update?: string; outcomes: ApiOutcome[] }
interface ApiBookmaker { key: string; title: string; last_update?: string; markets: ApiMarket[] }
export interface ApiEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: ApiBookmaker[];
}

function statusFor(commenceTime: string, now = Date.now()): GameStatus {
  return new Date(commenceTime).getTime() <= now ? "live" : "pregame";
}

export function normalizeGame(sport: OddsSport, event: ApiEvent, now = Date.now()): OddsGame {
  return {
    id: event.id,
    sport,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    homeAbbr: null,
    awayAbbr: null,
    homeLogo: null,
    awayLogo: null,
    commenceTime: event.commence_time,
    status: statusFor(event.commence_time, now),
    provider: "the-odds-api",
  };
}

export function normalizeEventQuotes(sport: OddsSport, event: ApiEvent): RawQuote[] {
  const quotes: RawQuote[] = [];
  for (const bookmaker of event.bookmakers ?? []) {
    const book = bookByOddsApiKey(bookmaker.key);
    if (!book) continue;
    for (const market of bookmaker.markets) {
      for (const outcome of market.outcomes) {
        const american = Number(outcome.price);
        const decimal = americanToDecimal(american);
        if (!Number.isFinite(decimal) || decimal <= 1) continue;
        quotes.push({
          gameId: event.id,
          sport,
          market: market.key,
          book: book.key,
          selection: outcome.name,
          participant: outcome.description?.trim() ?? "",
          point: typeof outcome.point === "number" ? outcome.point : null,
          american: Math.round(american),
          decimal,
          bookUpdatedAt: market.last_update ?? bookmaker.last_update ?? null,
        });
      }
    }
  }
  return quotes;
}

/** Moneyline, spread and total for every listed game in one request. */
export async function fetchFeaturedBoard(sport: OddsSport, markets: string[]): Promise<ProviderBoard> {
  const events = await call<ApiEvent[]>(`/sports/${SPORT_CONFIG[sport].oddsApiKey}/odds`, {
    bookmakers: bookmakersParam(),
    markets: markets.join(","),
    oddsFormat: "american",
    dateFormat: "iso",
  });
  const now = Date.now();
  return {
    source: "the-odds-api",
    games: events.map((event) => normalizeGame(sport, event, now)),
    quotes: events.flatMap((event) => normalizeEventQuotes(sport, event)),
  };
}

/** Free endpoint: upcoming and in-progress events without prices. */
export async function fetchEvents(sport: OddsSport): Promise<OddsGame[]> {
  const events = await call<ApiEvent[]>(`/sports/${SPORT_CONFIG[sport].oddsApiKey}/events`, { dateFormat: "iso" });
  const now = Date.now();
  return events.map((event) => normalizeGame(sport, event, now));
}

async function fetchEventOnce(sport: OddsSport, eventId: string, markets: string[]): Promise<ApiEvent> {
  return call<ApiEvent>(`/sports/${SPORT_CONFIG[sport].oddsApiKey}/events/${encodeURIComponent(eventId)}/odds`, {
    bookmakers: bookmakersParam(),
    markets: markets.join(","),
    oddsFormat: "american",
    dateFormat: "iso",
  });
}

/**
 * Period, team-total, alternate and player-prop markets for one event. If the provider rejects
 * the market list (unsupported key for this sport), each market is retried alone once and the
 * rejected keys are remembered so they never cost credits again.
 */
export async function fetchEventMarkets(sport: OddsSport, eventId: string, markets: string[]): Promise<{ game: OddsGame | null; quotes: RawQuote[] }> {
  const requested = markets.filter((market) => !rejectedMarkets.has(`${sport}|${market}`));
  if (!requested.length) return { game: null, quotes: [] };
  try {
    const event = await fetchEventOnce(sport, eventId, requested);
    return { game: normalizeGame(sport, event), quotes: normalizeEventQuotes(sport, event) };
  } catch (error) {
    if (!(error instanceof OddsProviderError && error.status === 422)) throw error;
    if (requested.length === 1) {
      rejectedMarkets.add(`${sport}|${requested[0]}`);
      return { game: null, quotes: [] };
    }
  }
  let game: OddsGame | null = null;
  const quotes: RawQuote[] = [];
  for (const market of requested) {
    try {
      const event = await fetchEventOnce(sport, eventId, [market]);
      game = normalizeGame(sport, event);
      quotes.push(...normalizeEventQuotes(sport, event));
    } catch (error) {
      if (error instanceof OddsProviderError && error.status === 422) rejectedMarkets.add(`${sport}|${market}`);
      else if (error instanceof OddsProviderError && error.status === 404) return { game: null, quotes: [] };
      else throw error;
    }
  }
  return { game, quotes };
}
