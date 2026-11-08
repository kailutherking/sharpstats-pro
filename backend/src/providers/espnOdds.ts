import { bookByEspnName, SPORT_CONFIG, type OddsSport } from "../services/oddsCatalog";
import { americanToDecimal } from "../services/evCalculator.service";
import type { GameStatus, OddsGame, ProviderBoard, RawQuote } from "../services/oddsTypes";

/**
 * Keyless fallback: ESPN's public scoreboard publishes its partner sportsbook's (DraftKings)
 * moneyline, spread and total with opening and current prices. One book cannot support no-vig
 * consensus, EV or arbitrage, so those scanners stay empty until ODDS_API_KEY is configured.
 */

const SITE_API = (process.env.ESPN_SITE_API_URL ?? "https://site.api.espn.com").replace(/\/+$/, "");
const TIMEOUT_MS = Math.max(2000, Number(process.env.ODDS_PROVIDER_TIMEOUT_MS ?? 15000) || 15000);
const DAYS_AHEAD = 3;

interface EspnSide { close?: { odds?: string; line?: string }; open?: { odds?: string; line?: string } }
interface EspnOdds {
  provider?: { name?: string; displayName?: string };
  moneyline?: { home?: EspnSide; away?: EspnSide };
  pointSpread?: { home?: EspnSide; away?: EspnSide };
  total?: { over?: EspnSide; under?: EspnSide };
}
interface EspnCompetitor { homeAway: "home" | "away"; team: { displayName: string; abbreviation?: string; logo?: string } }
export interface EspnEvent {
  id: string;
  date: string;
  competitions: Array<{
    status?: { type?: { state?: string } };
    competitors: EspnCompetitor[];
    odds?: EspnOdds[];
  }>;
}

/** "-110" → -110, "+251" → 251, "EVEN" → 100; "OFF" and blanks → null. */
export function parseAmerican(value: string | undefined): number | null {
  if (!value) return null;
  const text = value.trim().toUpperCase();
  if (text === "EVEN" || text === "EV") return 100;
  const parsed = Number(text.replace(/^\+/, ""));
  return Number.isFinite(parsed) && Math.abs(parsed) >= 100 ? parsed : null;
}

/** "-9.5" → -9.5, "o47.5" / "u47.5" → 47.5, "PK" → 0. */
export function parseLine(value: string | undefined): number | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (text === "pk" || text === "pick") return 0;
  const parsed = Number(text.replace(/^[ou]/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function easternDate(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

function statusOf(state: string | undefined): GameStatus {
  return state === "in" ? "live" : state === "post" ? "final" : "pregame";
}

function quote(base: Omit<RawQuote, "american" | "decimal" | "point" | "providerOpen" | "selection">, selection: string, side: EspnSide | undefined, withLine: boolean): RawQuote | null {
  const american = parseAmerican(side?.close?.odds);
  if (american === null) return null;
  const point = withLine ? parseLine(side?.close?.line) : null;
  if (withLine && point === null) return null;
  const openAmerican = parseAmerican(side?.open?.odds);
  return {
    ...base,
    selection,
    point,
    american,
    decimal: americanToDecimal(american),
    providerOpen: openAmerican === null ? undefined : { american: openAmerican, point: withLine ? parseLine(side?.open?.line) : null },
  };
}

export function normalizeEspnEvent(sport: OddsSport, event: EspnEvent): { game: OddsGame; quotes: RawQuote[] } | null {
  const competition = event.competitions[0];
  const home = competition?.competitors.find((team) => team.homeAway === "home");
  const away = competition?.competitors.find((team) => team.homeAway === "away");
  if (!competition || !home || !away) return null;
  const gameId = `espn-${event.id}`;
  const game: OddsGame = {
    id: gameId,
    sport,
    homeTeam: home.team.displayName,
    awayTeam: away.team.displayName,
    homeAbbr: home.team.abbreviation ?? null,
    awayAbbr: away.team.abbreviation ?? null,
    homeLogo: home.team.logo ?? null,
    awayLogo: away.team.logo ?? null,
    commenceTime: new Date(event.date).toISOString(),
    status: statusOf(competition.status?.type?.state),
    provider: "espn",
  };
  const quotes: RawQuote[] = [];
  for (const odds of competition.odds ?? []) {
    const book = bookByEspnName(odds.provider?.name ?? odds.provider?.displayName ?? "");
    if (!book) continue;
    const base = { gameId, sport, book: book.key, participant: "", bookUpdatedAt: null };
    const candidates = [
      quote({ ...base, market: "h2h" }, game.homeTeam, odds.moneyline?.home, false),
      quote({ ...base, market: "h2h" }, game.awayTeam, odds.moneyline?.away, false),
      quote({ ...base, market: "spreads" }, game.homeTeam, odds.pointSpread?.home, true),
      quote({ ...base, market: "spreads" }, game.awayTeam, odds.pointSpread?.away, true),
      quote({ ...base, market: "totals" }, "Over", odds.total?.over, true),
      quote({ ...base, market: "totals" }, "Under", odds.total?.under, true),
    ];
    for (const candidate of candidates) if (candidate && candidate.decimal > 1) quotes.push(candidate);
  }
  return { game, quotes };
}

async function scoreboard(sport: OddsSport, date?: string): Promise<EspnEvent[]> {
  const url = new URL(`${SITE_API}/apis/site/v2/sports/${SPORT_CONFIG[sport].espnPath}/scoreboard`);
  if (date) url.searchParams.set("dates", date);
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`ESPN scoreboard request failed (${response.status})`);
  const payload = await response.json() as { events?: EspnEvent[] };
  return payload.events ?? [];
}

export async function fetchEspnBoard(sport: OddsSport): Promise<ProviderBoard> {
  // NFL's default scoreboard is the current week; other leagues are fetched day by day (US Eastern dates).
  const days = sport === "nfl" ? [undefined] : Array.from({ length: DAYS_AHEAD }, (_, index) => easternDate(index));
  const results = await Promise.allSettled(days.map((day) => scoreboard(sport, day)));
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<EspnEvent[]> => result.status === "fulfilled");
  if (!fulfilled.length) {
    const reason = results[0]?.status === "rejected" ? results[0].reason : null;
    throw reason instanceof Error ? reason : new Error("ESPN scoreboard unavailable");
  }
  const seen = new Set<string>();
  const games: OddsGame[] = [];
  const quotes: RawQuote[] = [];
  for (const event of fulfilled.flatMap((result) => result.value)) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const normalized = normalizeEspnEvent(sport, event);
    if (!normalized || normalized.game.status === "final") continue;
    games.push(normalized.game);
    quotes.push(...normalized.quotes);
  }
  return { source: "espn", games, quotes };
}
