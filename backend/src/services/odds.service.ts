import { pool } from "../db/pool";
import {
  fetchEvents, fetchEventMarkets, fetchFeaturedBoard, oddsApiConfigured, oddsApiUsage, OddsProviderError, rejectedMarketKeys, seedOddsApiUsage,
} from "../providers/theOddsApi";
import { fetchEspnBoard } from "../providers/espnOdds";
import {
  bookByKey, eventMarkets, featuredMarkets, getBooks, MARKETS, marketDef, ODDS_SPORTS, propMarkets, SPORT_CONFIG,
  type MarketCategory, type OddsSport,
} from "./oddsCatalog";
import { aggregate, lineIdentity, type ArbitrageOpportunity, type Selection } from "./oddsAggregator.service";
import {
  KELLY_MULTIPLIER, MAX_STAKE_FRACTION, americanToDecimal, confidenceRating, recentEvHistory, syncEvHistory, type EvSnapshot,
} from "./evCalculator.service";
import { arbitrageStakes, recentClosedArbitrage, syncArbitrage, type ArbitrageWithAge } from "./arbitrage.service";
import {
  lineIdOf, lineStates, listMovements, priceHistory, pruneHistory, rangeHistory, recentMoveEvents, recordQuotes, recordSelectionRanges, signalsFor, type MoveEvent,
} from "./lineMovement.service";
import { buildAlerts, pruneAlerts, storeAlerts } from "./oddsAlerts.service";
import { attachResearch, buildPropRows, type PropRow } from "./propResearch.service";
import { broadcast, closeAllStreams, streamClients } from "./oddsStream";
import { formatInterval, nextResetAt, pacedIntervalMs } from "./creditPacing";
import type { OddsGame, OddsSource, RawQuote } from "./oddsTypes";

/* ---------- Configuration ---------- */

const seconds = (name: string, fallback: number, min: number) => Math.max(min, Number(process.env[name] ?? fallback) || fallback) * 1000;

export const REFRESH_MS = seconds("ODDS_REFRESH_SECONDS", 30, 10);
const IDLE_MS = seconds("ODDS_IDLE_SECONDS", 180, 30);
const BACKGROUND_MS = Math.max(0, Number(process.env.ODDS_BACKGROUND_REFRESH_MINUTES ?? 30)) * 60_000;
const EVENT_TTL_MS = seconds("ODDS_EVENT_REFRESH_SECONDS", 120, 30);
const PROP_TTL_MS = seconds("ODDS_PROP_REFRESH_SECONDS", 180, 30);
const PROP_SCAN_MAX_EVENTS = Math.max(1, Number(process.env.ODDS_PROP_SCAN_MAX_EVENTS ?? 12) || 12);
const PROP_SCAN_WINDOW_MS = 36 * 3_600_000;
const LOW_CREDITS = Math.max(0, Number(process.env.ODDS_MIN_CREDITS ?? 250) || 0);
const THROTTLED_MS = 10 * 60_000;
const RESEARCH_LIMIT = Math.max(0, Number(process.env.ODDS_PROP_RESEARCH_LIMIT ?? 60) || 0);
const FIRST_LOAD_TIMEOUT_MS = 25_000;
const CREDIT_PACING = process.env.ODDS_CREDIT_PACING !== "false";
const CREDITS_RESET_DAY = Number(process.env.ODDS_CREDITS_RESET_DAY ?? 1) || 1;

export type ProviderSetting = "auto" | "theoddsapi" | "espn";

/** ODDS_PROVIDER: "theoddsapi" (primary, needs ODDS_API_KEY), "espn" (keyless DraftKings only) or "auto". */
export function providerSetting(raw = process.env.ODDS_PROVIDER): ProviderSetting {
  const value = (raw ?? "").trim().toLowerCase().replace(/[\s_-]/g, "");
  if (value === "espn") return "espn";
  if (value === "theoddsapi" || value === "oddsapi") return "theoddsapi";
  return "auto";
}

export function providerMode(): OddsSource {
  if (providerSetting() === "espn") return "espn";
  return oddsApiConfigured() ? "the-odds-api" : "espn";
}

/** Why the configured provider is not the one in use, if it is not. */
function providerWarning(): string | null {
  const raw = process.env.ODDS_PROVIDER?.trim();
  if (raw && providerSetting(raw) === "auto" && raw.toLowerCase() !== "auto") return `ODDS_PROVIDER="${raw}" is not recognised; use theoddsapi, espn or auto.`;
  if (providerSetting() === "theoddsapi" && !oddsApiConfigured()) return "ODDS_PROVIDER is theoddsapi but ODDS_API_KEY is empty. Showing DraftKings lines from ESPN until a key is set.";
  if (providerSetting() === "espn" && oddsApiConfigured()) return "ODDS_PROVIDER=espn: ODDS_API_KEY is set but ignored, so only DraftKings lines are shown.";
  return null;
}

function sharpBook(): string | null {
  return providerMode() === "the-odds-api" ? getBooks().find((book) => book.kind === "reference")?.key ?? null : null;
}

function throttled(): boolean {
  const usage = oddsApiUsage();
  return providerMode() === "the-odds-api" && usage.remaining !== null && usage.remaining < LOW_CREDITS;
}

/* ---------- Per-sport state ---------- */

interface Slice { quotes: RawQuote[]; fetchedAt: number; requestedAt: number; markets: string[]; gameIds: string[] }

interface SportState {
  games: Map<string, OddsGame>;
  featured: Slice | null;
  /** Keys: `game:<id>` (period/team/alternate markets), `props:<id>` (all props for a game), `scan:<market>` (one prop market across games). */
  slices: Map<string, Slice>;
  source: OddsSource | null;
  lastAttemptAt: number;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastDemandAt: number;
  emptyUntil: number;
  inflight: Map<string, Promise<void>>;
  version: number;
  computed: { version: number; selections: Selection[]; arbitrage: ArbitrageOpportunity[]; arbitrageWithAge: ArbitrageWithAge[] } | null;
  closingCaptured: Set<string>;
}

const states = new Map<OddsSport, SportState>(ODDS_SPORTS.map((sport) => [sport, {
  games: new Map(), featured: null, slices: new Map(), source: null, lastAttemptAt: 0, lastSuccessAt: null, lastError: null,
  lastDemandAt: 0, emptyUntil: 0, inflight: new Map(), version: 0, computed: null, closingCaptured: new Set(),
}]));

function isDemanded(sport: OddsSport, now: number): boolean {
  return now - state(sport).lastDemandAt < IDLE_MS || streamClients(sport) > 0;
}

/** Leagues that cost credits to refresh: anything not known to be empty (offseason leagues are skipped for free). */
function inSeason(sport: OddsSport): boolean {
  const st = state(sport);
  return !(st.featured && st.games.size === 0);
}

/** Featured refresh cost: one credit per featured market (all tracked books fit in one region). */
function refreshCost(sport: OddsSport): number {
  return featuredMarkets(sport).length;
}

/**
 * Credit pacing. Viewed leagues get the remaining credits (less a reserve) spread evenly until the
 * monthly reset. Background refresh of unviewed leagues only runs when the budget can also sustain it.
 */
function pacing(now = Date.now()): { intervalMs: number; backgroundPaused: boolean; resetAt: number } {
  const resetAt = nextResetAt(now, CREDITS_RESET_DAY);
  if (!CREDIT_PACING || providerMode() !== "the-odds-api") return { intervalMs: 0, backgroundPaused: false, resetAt };
  const remaining = oddsApiUsage().remaining;
  const cost = Math.max(...ODDS_SPORTS.map(refreshCost));
  const viewed = ODDS_SPORTS.filter((sport) => inSeason(sport) && isDemanded(sport, now)).length;
  const intervalMs = pacedIntervalMs({ remaining, costPerRefresh: cost, activeSports: Math.max(1, viewed), now, resetAt });
  const allInSeason = ODDS_SPORTS.filter(inSeason).length;
  const backgroundMs = pacedIntervalMs({ remaining, costPerRefresh: cost, activeSports: Math.max(1, allInSeason), now, resetAt });
  return { intervalMs, backgroundPaused: BACKGROUND_MS > 0 && backgroundMs > BACKGROUND_MS, resetAt };
}

/** Effective automatic refresh interval for a league: demand-driven base, low-credit throttle and credit pacing. 0 = off. */
export function autoIntervalMs(sport: OddsSport, now = Date.now()): number {
  const paced = pacing(now);
  if (!isDemanded(sport, now)) {
    if (!BACKGROUND_MS || paced.backgroundPaused) return 0;
    return throttled() ? Math.max(BACKGROUND_MS, THROTTLED_MS) : BACKGROUND_MS;
  }
  const base = throttled() ? Math.max(REFRESH_MS, THROTTLED_MS) : REFRESH_MS;
  return Math.max(base, paced.intervalMs);
}

function state(sport: OddsSport): SportState {
  return states.get(sport)!;
}

export function markDemand(sport: OddsSport): void {
  state(sport).lastDemandAt = Date.now();
}

function mergedQuotes(st: SportState): RawQuote[] {
  const byLine = new Map<string, { quote: RawQuote; at: number }>();
  const slices = [st.featured, ...st.slices.values()].filter((slice): slice is Slice => Boolean(slice));
  for (const slice of slices) {
    for (const quote of slice.quotes) {
      const id = lineIdOf(quote);
      const existing = byLine.get(id);
      if (!existing || slice.fetchedAt >= existing.at) byLine.set(id, { quote, at: slice.fetchedAt });
    }
  }
  return [...byLine.values()].map((entry) => entry.quote).filter((quote) => st.games.has(quote.gameId));
}

function compute(sport: OddsSport) {
  const st = state(sport);
  if (st.computed && st.computed.version === st.version) return st.computed;
  const { selections, arbitrage } = aggregate({
    games: st.games,
    quotes: mergedQuotes(st),
    lineStates: lineStates(),
    signals: signalsFor(sport, sharpBook()),
    sharpBook: sharpBook(),
  });
  st.computed = { version: st.version, selections, arbitrage, arbitrageWithAge: st.computed?.arbitrageWithAge ?? [] };
  return st.computed;
}

/* ---------- Provider refresh ---------- */

async function logRefresh(sport: OddsSport, scope: string, status: "ok" | "error", quotes: number, startedAt: number, error?: string): Promise<void> {
  const usage = oddsApiUsage();
  try {
    await pool.query(
      `INSERT INTO odds_refresh_log(sport, scope, provider, status, quotes, credits_remaining, credits_last, error, duration_ms)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [sport, scope, providerMode(), status, quotes, providerMode() === "the-odds-api" ? usage.remaining : null,
        providerMode() === "the-odds-api" ? usage.lastCost : null, error?.slice(0, 500) ?? null, Date.now() - startedAt],
    );
  } catch {
    // Logging must never break a refresh.
  }
}

async function persistGames(games: OddsGame[]): Promise<void> {
  if (!games.length) return;
  try {
    await pool.query(
      `INSERT INTO odds_games(id, sport, home_team, away_team, home_abbr, away_abbr, commence_time, status, provider, last_seen_at)
       SELECT *, NOW() FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::timestamptz[], $8::text[], $9::text[])
       ON CONFLICT (id) DO UPDATE SET commence_time=EXCLUDED.commence_time, status=EXCLUDED.status, last_seen_at=NOW()`,
      [games.map((g) => g.id), games.map((g) => g.sport), games.map((g) => g.homeTeam), games.map((g) => g.awayTeam),
        games.map((g) => g.homeAbbr), games.map((g) => g.awayAbbr), games.map((g) => g.commenceTime), games.map((g) => g.status), games.map((g) => g.provider)],
    );
  } catch (error) {
    console.warn("Odds game write failed", error instanceof Error ? error.message : error);
  }
}

/** After any slice lands: movement tracking, EV/arbitrage history, alerts, CLV capture and a push to open streams. */
async function afterSnapshot(sport: OddsSport, quotes: RawQuote[], scope: string): Promise<void> {
  const st = state(sport);
  const moves: MoveEvent[] = await recordQuotes(sport, quotes);
  st.version += 1;
  const computed = compute(sport);
  const evRows: EvSnapshot[] = computed.selections.flatMap((selection) => selection.books
    .filter((price) => price.ev !== null && price.ev >= 0.005)
    .map((price) => ({
      sideId: selection.id, sport, gameId: selection.gameId, market: selection.market, label: selection.label, book: price.book,
      american: price.american, fairProbability: selection.fair!.probability, ev: price.ev!, kelly: price.kelly ?? 0,
    })));
  const [openedEv, arbitrageResult] = await Promise.all([
    syncEvHistory(sport, evRows), syncArbitrage(sport, computed.arbitrage), recordSelectionRanges(sport, computed.selections),
  ]);
  computed.arbitrageWithAge = arbitrageResult.current;
  const alerts = await storeAlerts(buildAlerts({
    sport, games: st.games, selections: computed.selections, moves, openedArbitrage: arbitrageResult.opened, openedEv,
  }));
  void captureClosingLines(sport);
  broadcast(sport, "update", {
    sport, scope, at: new Date().toISOString(), moves: moves.length, alerts: alerts.length,
    positiveEv: computed.selections.filter((selection) => selection.tier).length, arbitrage: computed.arbitrage.length,
  });
  if (alerts.length) broadcast(sport, "alerts", alerts.slice(0, 20));
}

function errorMessage(error: unknown): string {
  if (error instanceof OddsProviderError) return error.status === 401 ? "The Odds API rejected ODDS_API_KEY (401)" : error.message;
  return error instanceof Error ? error.message : "Provider request failed";
}

async function refreshFeatured(sport: OddsSport): Promise<void> {
  const st = state(sport);
  const existing = st.inflight.get("featured");
  if (existing) return existing;
  const task = (async () => {
    const startedAt = Date.now();
    st.lastAttemptAt = startedAt;
    try {
      const mode = providerMode();
      if (mode === "the-odds-api" && Date.now() < st.emptyUntil) return;
      if (mode === "the-odds-api" && !st.featured) {
        // The events list is free; skip the priced odds call for leagues with nothing scheduled (offseason).
        const events = await fetchEvents(sport);
        if (!events.length) {
          st.emptyUntil = Date.now() + 30 * 60_000;
          st.source = mode;
          st.lastSuccessAt = Date.now();
          st.lastError = null;
          st.games = new Map();
          st.featured = { quotes: [], fetchedAt: Date.now(), requestedAt: Date.now(), markets: [], gameIds: [] };
          st.version += 1;
          return;
        }
      }
      const board = mode === "the-odds-api"
        ? await fetchFeaturedBoard(sport, featuredMarkets(sport).map((market) => market.key))
        : await fetchEspnBoard(sport);
      const fetchedAt = Date.now();
      const games = new Map(board.games.map((game) => [game.id, game]));
      // Keep games referenced by recent per-event slices even if the featured feed dropped them briefly.
      for (const slice of st.slices.values()) {
        if (fetchedAt - slice.fetchedAt > 3_600_000) continue;
        for (const id of slice.gameIds) if (!games.has(id) && st.games.has(id)) games.set(id, st.games.get(id)!);
      }
      st.games = games;
      st.featured = { quotes: board.quotes, fetchedAt, requestedAt: st.featured?.requestedAt ?? fetchedAt, markets: featuredMarkets(sport).map((m) => m.key), gameIds: board.games.map((g) => g.id) };
      st.source = board.source;
      st.lastSuccessAt = fetchedAt;
      st.lastError = null;
      if (!board.games.length) st.emptyUntil = fetchedAt + 30 * 60_000;
      await persistGames(board.games);
      await afterSnapshot(sport, board.quotes, "featured");
      void logRefresh(sport, "featured", "ok", board.quotes.length, startedAt);
    } catch (error) {
      st.lastError = errorMessage(error);
      void logRefresh(sport, "featured", "error", 0, startedAt, st.lastError);
      console.warn(`Odds refresh failed (${sport})`, st.lastError);
    }
  })().finally(() => st.inflight.delete("featured"));
  st.inflight.set("featured", task);
  return task;
}

async function refreshSlice(sport: OddsSport, key: string, markets: string[], gameIds: string[]): Promise<void> {
  const st = state(sport);
  const existing = st.inflight.get(key);
  if (existing) return existing;
  const task = (async () => {
    const startedAt = Date.now();
    try {
      const quotes: RawQuote[] = [];
      const seenGames: string[] = [];
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(3, gameIds.length) }, async () => {
        while (index < gameIds.length) {
          const gameId = gameIds[index++]!;
          const result = await fetchEventMarkets(sport, gameId, markets);
          if (result.game && !st.games.has(gameId)) st.games.set(gameId, result.game);
          if (result.quotes.length) seenGames.push(gameId);
          quotes.push(...result.quotes);
        }
      }));
      const previous = st.slices.get(key);
      st.slices.set(key, { quotes, fetchedAt: Date.now(), requestedAt: previous?.requestedAt ?? Date.now(), markets, gameIds });
      await afterSnapshot(sport, quotes, key);
      void logRefresh(sport, key.split(":")[0]!, "ok", quotes.length, startedAt);
      void syncMarketSupport(sport);
    } catch (error) {
      const message = errorMessage(error);
      st.lastError = message;
      void logRefresh(sport, key.split(":")[0]!, "error", 0, startedAt, message);
      throw new OddsProviderError(message, error instanceof OddsProviderError ? error.status : 502);
    }
  })().finally(() => st.inflight.delete(key));
  st.inflight.set(key, task);
  return task;
}

/** Serves cached data immediately and refreshes behind it; only the very first load is awaited. */
async function ensureFeatured(sport: OddsSport, force = false): Promise<void> {
  const st = state(sport);
  markDemand(sport);
  const interval = autoIntervalMs(sport);
  const due = !st.featured || (interval > 0 && Date.now() - st.lastAttemptAt >= interval);
  if (!force && !due) return;
  const task = refreshFeatured(sport);
  if (force || !st.featured) await Promise.race([task, new Promise((resolve) => setTimeout(resolve, FIRST_LOAD_TIMEOUT_MS).unref?.())]);
}

async function ensureSlice(sport: OddsSport, key: string, markets: string[], gameIds: string[], ttl: number, force = false): Promise<void> {
  if (providerMode() !== "the-odds-api" || !markets.length || !gameIds.length) return;
  const st = state(sport);
  const slice = st.slices.get(key);
  if (slice) slice.requestedAt = Date.now();
  if (!force && slice && Date.now() - slice.fetchedAt < Math.max(throttled() ? THROTTLED_MS : ttl, autoIntervalMs(sport))) return;
  const task = refreshSlice(sport, key, markets, gameIds);
  if (force || !slice) await task;
  else void task.catch(() => undefined);
}

function upcomingGameIds(sport: OddsSport): string[] {
  const now = Date.now();
  return [...state(sport).games.values()]
    .filter((game) => game.status !== "final" && new Date(game.commenceTime).getTime() < now + PROP_SCAN_WINDOW_MS)
    .sort((a, b) => a.commenceTime.localeCompare(b.commenceTime))
    .slice(0, PROP_SCAN_MAX_EVENTS)
    .map((game) => game.id);
}

export async function forceRefresh(sport: OddsSport): Promise<void> {
  state(sport).emptyUntil = 0;
  await ensureFeatured(sport, true);
}

/* ---------- Status ---------- */

export interface ProviderStatus {
  mode: OddsSource;
  label: string;
  configured: boolean;
  connected: boolean;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  nextRefreshAt: string | null;
  refreshSeconds: number;
  throttled: boolean;
  credits: ReturnType<typeof oddsApiUsage> | null;
  unsupportedMarkets: string[];
  streamClients: number;
  notes: string[];
  provider: ProviderSetting;
  warning: string | null;
  /** Set when credit pacing stretches automatic refreshes beyond ODDS_REFRESH_SECONDS. intervalSeconds null = paused. */
  pacing: { intervalSeconds: number | null; resetAt: string } | null;
}

export function providerStatus(sport: OddsSport): ProviderStatus {
  const st = state(sport);
  const mode = providerMode();
  const paced = pacing();
  // Interval while the screen is open (the status is read by a viewer).
  const interval = Math.max(throttled() ? THROTTLED_MS : REFRESH_MS, paced.intervalMs);
  const notes: string[] = [];
  const warning = providerWarning();
  if (warning) notes.push(warning);
  if (mode === "espn" && providerSetting() !== "espn") notes.push("Keyless mode: DraftKings lines via ESPN. Add ODDS_API_KEY for every sportsbook, period markets, player props, no-vig EV and arbitrage.");
  const pacingActive = mode === "the-odds-api" && paced.intervalMs > REFRESH_MS;
  if (pacingActive) {
    const remaining = oddsApiUsage().remaining ?? 0;
    const resetDate = new Date(paced.resetAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    notes.push(Number.isFinite(paced.intervalMs)
      ? `Credit pacing: ${remaining} The Odds API credits left until ${resetDate}, so this league updates automatically every ${formatInterval(paced.intervalMs)} while it's open${paced.backgroundPaused ? " (background updates paused)" : ""}. Use Refresh to update now (about ${refreshCost(sport)} credits).`
      : `Credit pacing: only ${remaining} credits left until ${resetDate}; automatic updates are paused and the rest is kept for manual refreshes.`);
  } else if (throttled()) notes.push(`Provider credits are below ${LOW_CREDITS}; refreshes slowed to every 10 minutes.`);
  if (mode === "the-odds-api" && sharpBook()) notes.push(`Fair odds use ${bookByKey(sharpBook()!)?.name ?? sharpBook()} no-vig when it prices the main line, otherwise the consensus of every priced book.`);
  return {
    mode,
    label: mode === "the-odds-api" ? "The Odds API" : "ESPN odds feed (DraftKings)",
    configured: oddsApiConfigured(),
    provider: providerSetting(),
    warning,
    connected: Boolean(st.lastSuccessAt && !st.lastError && (pacingActive || Date.now() - st.lastSuccessAt < Math.max(interval * 3, 120_000))),
    lastSuccessAt: st.lastSuccessAt ? new Date(st.lastSuccessAt).toISOString() : null,
    lastAttemptAt: st.lastAttemptAt ? new Date(st.lastAttemptAt).toISOString() : null,
    lastError: st.lastError,
    nextRefreshAt: st.lastAttemptAt && Number.isFinite(interval) ? new Date(st.lastAttemptAt + interval).toISOString() : null,
    refreshSeconds: Number.isFinite(interval) ? Math.round(interval / 1000) : 0,
    pacing: pacingActive ? { intervalSeconds: Number.isFinite(paced.intervalMs) ? Math.round(paced.intervalMs / 1000) : null, resetAt: new Date(paced.resetAt).toISOString() } : null,
    throttled: throttled(),
    credits: mode === "the-odds-api" ? oddsApiUsage() : null,
    unsupportedMarkets: rejectedMarketKeys(sport),
    streamClients: streamClients(sport),
    notes,
  };
}

/* ---------- Board ---------- */

export interface BoardFilters {
  category?: MarketCategory | "all";
  market?: string;
  book?: string;
  date?: string;
  tzOffset?: number;
  q?: string;
  evOnly?: boolean;
  arbOnly?: boolean;
  live?: boolean;
  pregame?: boolean;
  gameId?: string;
  limit?: number;
}

function localDate(iso: string, tzOffsetMinutes: number): string {
  return new Date(new Date(iso).getTime() - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function gameView(game: OddsGame) {
  return { ...game, label: `${game.awayTeam} @ ${game.homeTeam}` };
}

export function filterSelections(sport: OddsSport, selections: Selection[], filters: BoardFilters): Selection[] {
  const st = state(sport);
  const q = filters.q?.trim().toLowerCase();
  return selections.filter((selection) => {
    const game = st.games.get(selection.gameId);
    if (!game) return false;
    if (filters.gameId && selection.gameId !== filters.gameId) return false;
    if (filters.market && selection.market !== filters.market) return false;
    if (!filters.market && filters.category && filters.category !== "all" && selection.category !== filters.category) return false;
    if (filters.book && !selection.books.some((price) => price.book === filters.book)) return false;
    if (filters.date && localDate(game.commenceTime, filters.tzOffset ?? 0) !== filters.date) return false;
    if (filters.evOnly && !selection.tier) return false;
    if (filters.arbOnly && selection.arbitrage === null) return false;
    if (filters.live && !filters.pregame && game.status !== "live") return false;
    if (filters.pregame && !filters.live && game.status !== "pregame") return false;
    if (q) {
      const haystack = `${game.homeTeam} ${game.awayTeam} ${selection.label} ${selection.marketLabel} ${selection.participant} ${selection.books.map((price) => bookByKey(price.book)?.name ?? price.book).join(" ")}`.toLowerCase();
      if (!q.split(/\s+/).every((term) => haystack.includes(term))) return false;
    }
    return true;
  });
}

function metrics(sport: OddsSport, selections: Selection[], arbitrageCount: number) {
  const st = state(sport);
  const activeBooks = getBooks().filter((book) => !book.retired && book.kind !== "reference");
  const connected = new Set(selections.flatMap((selection) => selection.books.map((price) => price.book)).filter((key) => bookByKey(key)?.kind !== "reference"));
  const bestEdge = selections
    .filter((selection) => selection.best && selection.average)
    .map((selection) => ({ selection, edge: selection.average!.implied - 1 / selection.best!.decimal }))
    .sort((a, b) => b.edge - a.edge)[0];
  const lastUpdate = Math.max(st.featured?.fetchedAt ?? 0, ...[...st.slices.values()].map((slice) => slice.fetchedAt));
  return {
    bestAvailable: bestEdge ? { selectionId: bestEdge.selection.id, label: bestEdge.selection.label, market: bestEdge.selection.marketLabel, book: bestEdge.selection.best!.book, american: bestEdge.selection.best!.american, edge: bestEdge.edge } : null,
    positiveEv: selections.filter((selection) => selection.tier).length,
    evTiers: {
      positive: selections.filter((selection) => selection.tier === "positive").length,
      strong: selections.filter((selection) => selection.tier === "strong").length,
      elite: selections.filter((selection) => selection.tier === "elite").length,
    },
    arbitrage: arbitrageCount,
    booksConnected: [...connected].filter((key) => activeBooks.some((book) => book.key === key)).length,
    booksTotal: activeBooks.length,
    marketsTracked: new Set(selections.map((selection) => selection.pairId)).size,
    selectionsTracked: selections.length,
    gamesTracked: new Set(selections.map((selection) => selection.gameId)).size,
    liveGames: [...st.games.values()].filter((game) => game.status === "live").length,
    lineMovements: recentMoveEvents(sport, 3_600_000).length,
    steamMoves: selections.filter((selection) => selection.signals.steam).length,
    lastUpdate: lastUpdate ? new Date(lastUpdate).toISOString() : null,
  };
}

export function sizing(bankroll: number) {
  return { bankroll, kellyMultiplier: KELLY_MULTIPLIER, maxStakeFraction: MAX_STAKE_FRACTION };
}

export async function getBoard(sport: OddsSport, filters: BoardFilters) {
  await ensureFeatured(sport);
  const category = filters.market ? marketDef(sport, filters.market)?.category : filters.category;
  if (filters.gameId && category && ["period", "team", "alternate"].includes(category)) {
    await ensureSlice(sport, `game:${filters.gameId}`, eventMarkets(sport).map((market) => market.key), [filters.gameId], EVENT_TTL_MS).catch(() => undefined);
  }
  if (category === "prop") {
    if (filters.gameId) await ensureSlice(sport, `props:${filters.gameId}`, propMarkets(sport).map((market) => market.key), [filters.gameId], PROP_TTL_MS).catch(() => undefined);
    else if (filters.market) await ensureSlice(sport, `scan:${filters.market}`, [filters.market], upcomingGameIds(sport), PROP_TTL_MS).catch(() => undefined);
  }
  const st = state(sport);
  const computed = compute(sport);
  const all = computed.selections;
  const selections = filterSelections(sport, all, filters);
  const limit = Math.min(Math.max(filters.limit ?? 1500, 1), 4000);
  const marketCounts = new Map<string, number>();
  for (const selection of all) marketCounts.set(selection.market, (marketCounts.get(selection.market) ?? 0) + 1);
  return {
    sport,
    label: SPORT_CONFIG[sport].label,
    status: providerStatus(sport),
    games: [...st.games.values()].sort((a, b) => a.commenceTime.localeCompare(b.commenceTime)).map(gameView),
    selections: selections.slice(0, limit),
    totalSelections: selections.length,
    truncated: selections.length > limit,
    metrics: metrics(sport, all, computed.arbitrage.length),
    markets: MARKETS[sport].map((market) => ({
      key: market.key, label: market.label, short: market.short, category: market.category, type: market.type,
      selections: marketCounts.get(market.key) ?? 0,
      available: providerMode() === "the-odds-api" ? !rejectedMarketKeys(sport).includes(market.key) : Boolean(market.featured),
    })),
    books: booksView(sport, all),
    sharpBook: sharpBook(),
  };
}

function booksView(sport: OddsSport, selections: Selection[]) {
  const counts = new Map<string, number>();
  for (const selection of selections) for (const price of selection.books) counts.set(price.book, (counts.get(price.book) ?? 0) + 1);
  const mode = providerMode();
  return getBooks().map((book) => ({
    key: book.key,
    name: book.name,
    kind: book.kind,
    retired: book.retired ?? null,
    prices: counts.get(book.key) ?? 0,
    status: book.retired ? "retired" : counts.get(book.key) ? "connected" : mode === "espn" ? "requires_api_key" : "no_markets",
    sport,
  }));
}

export async function getLive(sport: OddsSport) {
  const board = await getBoard(sport, { live: true });
  const liveIds = new Set(board.games.filter((game) => game.status === "live").map((game) => game.id));
  return {
    ...board,
    games: board.games.filter((game) => liveIds.has(game.id)),
    recentMoves: recentMoveEvents(sport, 15 * 60_000).filter((move) => liveIds.has(move.gameId)).slice(-100).reverse(),
  };
}

export async function getGame(sport: OddsSport, gameId: string, options: { props?: boolean; force?: boolean } = {}) {
  await ensureFeatured(sport);
  const st = state(sport);
  if (!st.games.has(gameId) && providerMode() === "espn") return null;
  await ensureSlice(sport, `game:${gameId}`, eventMarkets(sport).map((market) => market.key), [gameId], EVENT_TTL_MS, options.force).catch((error: unknown) => {
    if (error instanceof OddsProviderError && error.status === 404) return;
    throw error;
  });
  if (options.props) await ensureSlice(sport, `props:${gameId}`, propMarkets(sport).map((market) => market.key), [gameId], PROP_TTL_MS, options.force).catch(() => undefined);
  const game = st.games.get(gameId);
  if (!game) return null;
  const selections = compute(sport).selections.filter((selection) => selection.gameId === gameId);
  const markets = MARKETS[sport]
    .map((market) => ({ key: market.key, label: market.label, category: market.category, type: market.type, selections: selections.filter((selection) => selection.market === market.key) }))
    .filter((market) => market.selections.length);
  return {
    sport,
    game: gameView(game),
    markets,
    status: providerStatus(sport),
    eventMarketsLoaded: Boolean(st.slices.get(`game:${gameId}`)),
    propsLoaded: Boolean(st.slices.get(`props:${gameId}`)),
    books: booksView(sport, selections),
  };
}

/**
 * The board's games and priced selections for a league, for the live tracker and injury reports.
 * Viewing counts as demand, so refreshes follow the normal credit-paced schedule; nothing extra is bought.
 */
export async function oddsSnapshot(sport: OddsSport): Promise<{ games: OddsGame[]; selections: Selection[]; fetchedAt: string | null; source: OddsSource | null }> {
  const st = state(sport);
  markDemand(sport);
  // After a restart the board is empty but the last refresh time is restored. Wait for the paced
  // slot instead of buying a refresh; callers fall back to ESPN's DraftKings lines meanwhile.
  const interval = autoIntervalMs(sport);
  if (st.featured || providerMode() !== "the-odds-api" || (interval > 0 && Date.now() - st.lastAttemptAt >= interval)) {
    await ensureFeatured(sport).catch(() => undefined);
  }
  return {
    games: [...st.games.values()],
    selections: compute(sport).selections,
    fetchedAt: st.featured ? new Date(st.featured.fetchedAt).toISOString() : null,
    source: st.source,
  };
}

/* ---------- Scanners ---------- */

export async function getEv(sport: OddsSport, options: { minEv: number; category?: MarketCategory | "all"; book?: string; market?: string }) {
  await ensureFeatured(sport);
  if (options.market && marketDef(sport, options.market)?.category === "prop") {
    await ensureSlice(sport, `scan:${options.market}`, [options.market], upcomingGameIds(sport), PROP_TTL_MS).catch(() => undefined);
  }
  const st = state(sport);
  const selections = filterSelections(sport, compute(sport).selections, { category: options.category, market: options.market });
  const rows = selections.flatMap((selection) => selection.books
    .filter((price) => price.ev !== null && price.ev >= options.minEv && (!options.book || price.book === options.book))
    .map((price) => ({
      selectionId: selection.id,
      gameId: selection.gameId,
      game: st.games.get(selection.gameId) ? gameView(st.games.get(selection.gameId)!).label : "",
      commenceTime: st.games.get(selection.gameId)?.commenceTime ?? null,
      status: st.games.get(selection.gameId)?.status ?? null,
      market: selection.market,
      marketLabel: selection.marketLabel,
      category: selection.category,
      label: selection.label,
      book: price.book,
      american: price.american,
      decimal: price.decimal,
      implied: price.implied,
      noVigProbability: selection.fair!.probability,
      fairAmerican: selection.fair!.american,
      fairSource: selection.fair!.sourceLabel,
      fairBooks: selection.fair!.books,
      ev: price.ev!,
      edge: selection.fair!.probability - price.implied,
      kelly: price.kelly ?? 0,
      tier: price.ev! >= 0.06 ? "elite" : price.ev! >= 0.03 ? "strong" : "positive",
      risk: selection.risk,
      confidence: confidenceRating({
        ev: price.ev!, decimal: price.decimal, fairBooks: selection.fair!.books, sharpReference: selection.fair!.source === "sharp",
        isProp: selection.category === "prop", booksAtLine: selection.books.filter((item) => item.priced && item.atLine).length,
        priceAgeSeconds: price.bookUpdatedAt ? Math.max(0, (Date.now() - Date.parse(price.bookUpdatedAt)) / 1000) : null,
        steam: selection.signals.steam, live: st.games.get(selection.gameId)?.status === "live",
      }),
      marketAverage: selection.average?.american ?? null,
      bestPrice: price.isBest,
      lastChangeAt: price.lastChangeAt,
      signals: selection.signals,
    })))
    .sort((a, b) => b.ev - a.ev);
  return { sport, status: providerStatus(sport), rows, history: await recentEvHistory(sport, 24, 100).catch(() => []) };
}

export async function getArbitrage(sport: OddsSport, total: number) {
  await ensureFeatured(sport);
  const st = state(sport);
  const computed = compute(sport);
  const current = computed.arbitrageWithAge.length || !computed.arbitrage.length
    ? computed.arbitrageWithAge
    : computed.arbitrage.map((item) => ({ ...item, firstSeenAt: new Date().toISOString(), peakProfitPct: item.profitPct }));
  return {
    sport,
    status: providerStatus(sport),
    total,
    opportunities: current.map((item) => ({
      ...item,
      game: st.games.get(item.gameId) ? gameView(st.games.get(item.gameId)!).label : "",
      commenceTime: st.games.get(item.gameId)?.commenceTime ?? null,
      stakes: arbitrageStakes(item, total),
      guaranteedProfit: Math.round(total * item.profitPct * 100) / 100,
    })),
    recentlyClosed: await recentClosedArbitrage(sport).catch(() => []),
  };
}

export async function getMovement(sport: OddsSport, filters: { gameId?: string; market?: string; hours: number }) {
  await ensureFeatured(sport);
  const st = state(sport);
  const selections = filterSelections(sport, compute(sport).selections, { gameId: filters.gameId, market: filters.market });
  const movers = selections
    .map((selection) => {
      const moved = selection.books.filter((price) => price.priced && price.probabilityMove !== null);
      const probabilityMove = moved.length ? moved.reduce((sum, price) => sum + price.probabilityMove!, 0) / moved.length : null;
      const pointMoves = moved.map((price) => price.pointMove).filter((value): value is number => value !== null);
      return { selection, probabilityMove, pointMove: pointMoves.length ? pointMoves.reduce((a, b) => a + b, 0) / pointMoves.length : null };
    })
    .filter((row) => row.probabilityMove !== null && (Math.abs(row.probabilityMove) >= 0.005 || (row.pointMove ?? 0) !== 0))
    .sort((a, b) => Math.abs(b.probabilityMove!) - Math.abs(a.probabilityMove!))
    .slice(0, 40)
    .map((row) => ({
      selectionId: row.selection.id, gameId: row.selection.gameId, label: row.selection.label, marketLabel: row.selection.marketLabel,
      game: st.games.get(row.selection.gameId) ? gameView(st.games.get(row.selection.gameId)!).label : "",
      probabilityMove: row.probabilityMove, pointMove: row.pointMove, signals: row.selection.signals,
      best: row.selection.best, books: row.selection.books.length,
    }));
  const flagged = selections.filter((selection) => selection.signals.steam || selection.signals.sharp || selection.signals.reverse).map((selection) => ({
    selectionId: selection.id, gameId: selection.gameId, label: selection.label, marketLabel: selection.marketLabel,
    game: st.games.get(selection.gameId) ? gameView(st.games.get(selection.gameId)!).label : "",
    signals: selection.signals, best: selection.best,
  }));
  const movements = await listMovements({ sport, gameId: filters.gameId, market: filters.market, hours: filters.hours, limit: 300 }).catch(() => []);
  const labels = new Map(compute(sport).selections.map((selection) => [selection.id, selection.label]));
  return {
    sport,
    status: providerStatus(sport),
    movers,
    steam: flagged.filter((row) => row.signals.steam),
    sharp: flagged.filter((row) => row.signals.sharp),
    reverse: flagged.filter((row) => row.signals.reverse),
    sharpReference: sharpBook(),
    movements: movements.map((move) => ({
      ...move,
      label: labels.get(move.sideId) ?? (move.participant ? `${move.participant} ${move.selection}` : move.selection),
      game: st.games.get(move.gameId) ? gameView(st.games.get(move.gameId)!).label : "",
    })),
  };
}

export async function getHistory(sport: OddsSport, sideId: string, book?: string) {
  const selection = compute(sport).selections.find((item) => item.id === sideId) ?? null;
  const [points, range] = await Promise.all([priceHistory(sideId, book), book ? Promise.resolve([]) : rangeHistory(sideId).catch(() => [])]);
  return {
    sport,
    sideId,
    selection: selection ? {
      id: selection.id, label: selection.label, marketLabel: selection.marketLabel, gameId: selection.gameId, books: selection.books,
      fair: selection.fair, average: selection.average, best: selection.best, worst: selection.worst, signals: selection.signals,
    } : null,
    points,
    range,
  };
}

/* ---------- Player props ---------- */

export interface PropFilters {
  gameId?: string;
  market?: string;
  player?: string;
  team?: string;
  book?: string;
  date?: string;
  tzOffset?: number;
  type?: "ou" | "yes";
  research?: boolean;
}

export async function getPlayerProps(sport: OddsSport, filters: PropFilters) {
  await ensureFeatured(sport);
  const st = state(sport);
  const markets = propMarkets(sport);
  const market = filters.market && markets.some((item) => item.key === filters.market) ? filters.market : undefined;
  const scanMarket = market ?? (filters.gameId ? undefined : markets[0]?.key);
  let providerError: string | null = null;
  if (providerMode() === "the-odds-api") {
    try {
      if (filters.gameId) await ensureSlice(sport, `props:${filters.gameId}`, markets.map((item) => item.key), [filters.gameId], PROP_TTL_MS);
      else if (scanMarket) await ensureSlice(sport, `scan:${scanMarket}`, [scanMarket], upcomingGameIds(sport), PROP_TTL_MS);
    } catch (error) {
      providerError = errorMessage(error);
    }
  }
  const selections = filterSelections(sport, compute(sport).selections, { category: "prop", gameId: filters.gameId, market: market ?? (filters.gameId ? undefined : scanMarket), date: filters.date, tzOffset: filters.tzOffset });
  let rows: PropRow[] = buildPropRows(selections, st.games);
  if (filters.player) {
    const q = filters.player.toLowerCase();
    rows = rows.filter((row) => row.player.toLowerCase().includes(q));
  }
  if (filters.team) {
    const q = filters.team.toLowerCase();
    rows = rows.filter((row) => row.game.toLowerCase().includes(q));
  }
  if (filters.book) rows = rows.filter((row) => row.books.includes(filters.book!));
  if (filters.type === "yes") rows = rows.filter((row) => row.type === "prop_yes");
  if (filters.type === "ou") rows = rows.filter((row) => row.type === "prop_ou");
  const research = filters.research === false ? { researched: 0, unmatched: 0 } : await attachResearch(sport, rows, st.games, RESEARCH_LIMIT);
  return {
    sport,
    status: { ...providerStatus(sport), lastError: providerError ?? providerStatus(sport).lastError },
    market: market ?? scanMarket ?? null,
    markets: markets.map((item) => ({ key: item.key, label: item.label, short: item.short, type: item.type, available: !rejectedMarketKeys(sport).includes(item.key) })),
    games: [...st.games.values()].sort((a, b) => a.commenceTime.localeCompare(b.commenceTime)).map(gameView),
    rows,
    research: { ...research, limit: RESEARCH_LIMIT },
    requiresApiKey: providerMode() !== "the-odds-api",
  };
}

/* ---------- Search ---------- */

export interface SearchResult {
  kind: "game" | "team" | "player" | "market" | "sportsbook" | "prop";
  label: string;
  detail: string;
  sport: OddsSport | null;
  gameId?: string;
  market?: string;
  book?: string;
  selectionId?: string;
}

export function search(query: string, limit = 30): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const results: SearchResult[] = [];
  const push = (result: SearchResult) => { if (results.length < limit * 3) results.push(result); };
  for (const book of getBooks()) if (book.name.toLowerCase().includes(q)) push({ kind: "sportsbook", label: book.name, detail: book.kind === "dfs" ? "Pick'em app" : book.kind === "reference" ? "Sharp reference" : "Sportsbook", sport: null, book: book.key });
  for (const sport of ODDS_SPORTS) {
    const st = state(sport);
    for (const market of MARKETS[sport]) if (market.label.toLowerCase().includes(q)) push({ kind: "market", label: market.label, detail: `${SPORT_CONFIG[sport].label} · ${market.category}`, sport, market: market.key });
    const teams = new Set<string>();
    for (const game of st.games.values()) {
      const label = `${game.awayTeam} @ ${game.homeTeam}`;
      if (label.toLowerCase().includes(q)) push({ kind: "game", label, detail: `${SPORT_CONFIG[sport].label} · ${new Date(game.commenceTime).toISOString()}`, sport, gameId: game.id });
      for (const team of [game.homeTeam, game.awayTeam]) if (team.toLowerCase().includes(q) && !teams.has(team)) {
        teams.add(team);
        push({ kind: "team", label: team, detail: `${SPORT_CONFIG[sport].label} · ${label}`, sport, gameId: game.id });
      }
    }
    if (!st.computed) continue;
    const players = new Set<string>();
    for (const selection of st.computed.selections) {
      if (selection.category !== "prop" || !selection.participant.toLowerCase().includes(q)) continue;
      const game = st.games.get(selection.gameId);
      if (!players.has(selection.participant)) {
        players.add(selection.participant);
        push({ kind: "player", label: selection.participant, detail: `${SPORT_CONFIG[sport].label}${game ? ` · ${game.awayTeam} @ ${game.homeTeam}` : ""}`, sport, gameId: selection.gameId });
      }
      if (/^(over|yes)$/i.test(selection.selection)) push({ kind: "prop", label: `${selection.participant} ${selection.marketLabel}${selection.point === null ? "" : ` ${selection.point}`}`, detail: SPORT_CONFIG[sport].label, sport, gameId: selection.gameId, market: selection.market, selectionId: selection.id });
    }
  }
  const rank: Record<SearchResult["kind"], number> = { game: 0, team: 1, player: 2, prop: 3, market: 4, sportsbook: 5 };
  return results.sort((a, b) => rank[a.kind] - rank[b.kind] || a.label.localeCompare(b.label)).slice(0, limit);
}

/* ---------- Closing line value ---------- */

function sportOfBet(bet: { sport: string; league: string; event_id: string | null }): OddsSport | null {
  for (const sport of ODDS_SPORTS) if (bet.event_id && state(sport).games.has(bet.event_id)) return sport;
  const label = `${bet.sport} ${bet.league}`.toLowerCase();
  return ODDS_SPORTS.find((sport) => label.includes(sport) || label.includes(SPORT_CONFIG[sport].label.toLowerCase())) ?? null;
}

function betSideId(sport: OddsSport, bet: { event_id: string; market_key: string; selection: string; team_player: string; line_value: string | null }): string {
  const selection = bet.selection || bet.team_player;
  const participant = bet.team_player && bet.team_player !== selection ? bet.team_player : "";
  return lineIdentity({ gameId: bet.event_id, market: bet.market_key, participant, selection, point: bet.line_value === null ? null : Number(bet.line_value) }, marketDef(sport, bet.market_key)?.category);
}

function bookKeyByName(name: string): string | null {
  const lower = name.trim().toLowerCase();
  return getBooks().find((book) => book.name.toLowerCase() === lower || book.key === lower)?.key ?? null;
}

/** When a tracked game starts, stores each linked bet's closing price from the same book's last pregame number. */
async function captureClosingLines(sport: OddsSport): Promise<void> {
  const st = state(sport);
  const now = Date.now();
  const started = [...st.games.values()].filter((game) => !st.closingCaptured.has(game.id) && new Date(game.commenceTime).getTime() <= now - 5 * 60_000);
  if (!started.length) return;
  for (const game of started) st.closingCaptured.add(game.id);
  try {
    const bets = await pool.query<{ id: number; event_id: string; market_key: string; selection: string; team_player: string; line_value: string | null; sportsbook: string }>(
      `SELECT id, event_id, market_key, selection, team_player, line_value::text, sportsbook FROM bets
       WHERE closing_odds IS NULL AND event_id = ANY($1::text[])`,
      [started.map((game) => game.id)],
    );
    for (const bet of bets.rows) {
      const book = bookKeyByName(bet.sportsbook);
      const game = st.games.get(bet.event_id);
      if (!book || !game) continue;
      const closing = await pool.query<{ price_american: number }>(
        `SELECT price_american FROM odds_history WHERE side_id=$1 AND book_key=$2 AND observed_at <= $3
         ORDER BY observed_at DESC LIMIT 1`,
        [betSideId(sport, bet), book, game.commenceTime],
      );
      const american = closing.rows[0]?.price_american;
      if (american === undefined) continue;
      await pool.query("UPDATE bets SET closing_odds=$2 WHERE id=$1 AND closing_odds IS NULL", [bet.id, Math.round(americanToDecimal(american) * 1000) / 1000]);
    }
  } catch (error) {
    console.warn("Closing line capture failed", error instanceof Error ? error.message : error);
  }
}

export async function getClv(userId: number) {
  const result = await pool.query<{
    id: number; sport: string; league: string; event: string; event_id: string | null; market_key: string; selection: string; team_player: string;
    line_value: string | null; odds: string; closing_odds: string | null; sportsbook: string; result: string; bet_date: Date; stake: string;
  }>(
    `SELECT id, sport, league, event, event_id, market_key, selection, team_player, line_value::text, odds::text, closing_odds::text,
            sportsbook, result, bet_date, stake::text
     FROM bets WHERE user_id=$1 AND bet_date > NOW() - INTERVAL '120 days' ORDER BY bet_date DESC LIMIT 300`,
    [userId],
  );
  const rows = result.rows.map((bet) => {
    const odds = Number(bet.odds);
    const closing = bet.closing_odds === null ? null : Number(bet.closing_odds);
    const sport = sportOfBet(bet);
    let current: { american: number | null; fairProbability: number | null; best: Selection["best"] } | null = null;
    if (sport && bet.event_id) {
      const sideId = betSideId(sport, { ...bet, event_id: bet.event_id });
      const selection = state(sport).computed?.selections.find((item) => item.id === sideId);
      if (selection) current = { american: selection.fair?.american ?? null, fairProbability: selection.fair?.probability ?? null, best: selection.best };
    }
    return {
      id: bet.id,
      event: bet.event,
      selection: bet.selection || bet.team_player,
      market: bet.market_key,
      sportsbook: bet.sportsbook,
      result: bet.result,
      betDate: bet.bet_date.toISOString(),
      stake: Number(bet.stake),
      odds,
      closingOdds: closing,
      /** Price CLV: how much better the taken price was than the close (decimal odds ratio). */
      clv: closing ? odds / closing - 1 : null,
      /** Open bets: edge of the taken price against the current no-vig fair price. */
      liveClv: current?.fairProbability ? odds * current.fairProbability - 1 : null,
      current,
      status: closing ? "closed" : current ? "tracking" : "unlinked",
    };
  });
  const closed = rows.filter((row) => row.clv !== null);
  return {
    rows,
    summary: {
      bets: rows.length,
      closed: closed.length,
      tracking: rows.filter((row) => row.status === "tracking").length,
      averageClv: closed.length ? closed.reduce((sum, row) => sum + row.clv!, 0) / closed.length : null,
      beatClosePct: closed.length ? closed.filter((row) => row.clv! > 0).length / closed.length : null,
    },
  };
}

/* ---------- Favorites (markets, props, games) ---------- */

export interface OddsFavorite { kind: "market" | "prop" | "game"; itemKey: string; label: string; sport: OddsSport; createdAt?: string }

export async function listOddsFavorites(userId: number): Promise<OddsFavorite[]> {
  const result = await pool.query<{ kind: OddsFavorite["kind"]; item_key: string; label: string; sport: OddsSport; created_at: Date }>(
    "SELECT kind, item_key, label, sport, created_at FROM odds_favorites WHERE user_id=$1 ORDER BY created_at DESC",
    [userId],
  );
  return result.rows.map((row) => ({ kind: row.kind, itemKey: row.item_key, label: row.label, sport: row.sport, createdAt: row.created_at.toISOString() }));
}

export async function setOddsFavorite(userId: number, favorite: OddsFavorite, enabled: boolean): Promise<boolean> {
  if (enabled) {
    await pool.query(
      `INSERT INTO odds_favorites(user_id, kind, item_key, label, sport) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, kind, item_key) DO UPDATE SET label=EXCLUDED.label`,
      [userId, favorite.kind, favorite.itemKey, favorite.label, favorite.sport],
    );
  } else {
    await pool.query("DELETE FROM odds_favorites WHERE user_id=$1 AND kind=$2 AND item_key=$3", [userId, favorite.kind, favorite.itemKey]);
  }
  return enabled;
}

/* ---------- Sportsbooks ---------- */

export async function getSportsbooks(userId: number) {
  const favorites = await pool.query<{ id: number; name: string; favorite: boolean }>(
    `SELECT s.id, s.name, (f.user_id IS NOT NULL) AS favorite FROM sportsbooks s
     LEFT JOIN favorite_sportsbooks f ON f.sportsbook_id=s.id AND f.user_id=$1`,
    [userId],
  );
  const byName = new Map(favorites.rows.map((row) => [row.name.toLowerCase(), row]));
  const counts = new Map<string, { prices: number; sports: Set<OddsSport> }>();
  for (const sport of ODDS_SPORTS) {
    for (const selection of state(sport).computed?.selections ?? []) {
      for (const price of selection.books) {
        const entry = counts.get(price.book) ?? { prices: 0, sports: new Set<OddsSport>() };
        entry.prices += 1;
        entry.sports.add(sport);
        counts.set(price.book, entry);
      }
    }
  }
  const mode = providerMode();
  return {
    mode,
    sportsbooks: getBooks().map((book) => {
      const row = byName.get(book.name.toLowerCase());
      const usage = counts.get(book.key);
      return {
        id: row?.id ?? null,
        key: book.key,
        name: book.name,
        kind: book.kind,
        favorite: row?.favorite ?? false,
        retired: book.retired ?? null,
        prices: usage?.prices ?? 0,
        sports: [...(usage?.sports ?? [])],
        status: book.retired ? "retired" : usage?.prices ? "connected" : mode === "espn" ? "requires_api_key" : "no_markets",
      };
    }),
    providers: ODDS_SPORTS.map((sport) => ({ sport, ...providerStatus(sport) })),
  };
}

/** Keeps the sportsbooks and odds_markets tables aligned with the registry so books/markets are data, not code-only. */
export async function syncRegistry(): Promise<void> {
  const books = getBooks();
  await pool.query(
    `INSERT INTO sportsbooks(name, region, book_key, kind, active)
     SELECT n, 'US', k, t, a FROM unnest($1::text[], $2::text[], $3::text[], $4::boolean[]) AS x(n, k, t, a)
     ON CONFLICT (name) DO UPDATE SET book_key=EXCLUDED.book_key, kind=EXCLUDED.kind, active=EXCLUDED.active`,
    [books.map((book) => book.name), books.map((book) => book.key), books.map((book) => book.kind), books.map((book) => !book.retired)],
  );
  const markets = ODDS_SPORTS.flatMap((sport) => MARKETS[sport].map((market) => ({ sport, ...market })));
  await pool.query(
    `INSERT INTO odds_markets(sport, market_key, label, category, market_type, period, featured)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::boolean[])
     ON CONFLICT (sport, market_key) DO UPDATE SET label=EXCLUDED.label, category=EXCLUDED.category,
       market_type=EXCLUDED.market_type, period=EXCLUDED.period, featured=EXCLUDED.featured`,
    [markets.map((m) => m.sport), markets.map((m) => m.key), markets.map((m) => m.label), markets.map((m) => m.category),
      markets.map((m) => m.type), markets.map((m) => m.period), markets.map((m) => Boolean(m.featured))],
  );
}

async function syncMarketSupport(sport: OddsSport): Promise<void> {
  const rejected = rejectedMarketKeys(sport);
  if (!rejected.length) return;
  await pool.query("UPDATE odds_markets SET supported=false WHERE sport=$1 AND market_key = ANY($2::text[])", [sport, rejected]).catch(() => undefined);
}

/* ---------- Scheduler ---------- */

async function restoreRefreshState(): Promise<void> {
  if (providerMode() !== "the-odds-api") return;
  try {
    const credits = await pool.query<{ credits_remaining: number; created_at: Date }>(
      `SELECT credits_remaining, created_at FROM odds_refresh_log
       WHERE provider = 'the-odds-api' AND credits_remaining IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    );
    const last = credits.rows[0];
    if (last) seedOddsApiUsage({ remaining: last.credits_remaining, updatedAt: last.created_at.toISOString() });
    const attempts = await pool.query<{ sport: OddsSport; last_at: Date }>(
      `SELECT sport, MAX(created_at) AS last_at FROM odds_refresh_log
       WHERE provider = 'the-odds-api' AND scope = 'featured' GROUP BY sport`,
    );
    for (const row of attempts.rows) {
      if (!ODDS_SPORTS.includes(row.sport)) continue;
      const st = state(row.sport);
      st.lastAttemptAt = Math.max(st.lastAttemptAt, row.last_at.getTime());
    }
  } catch (error) {
    console.warn("Odds refresh state restore failed", error instanceof Error ? error.message : error);
  }
}

export function startOddsScheduler(): () => void {
  if (process.env.ODDS_AUTO_REFRESH === "false") return () => undefined;
  void syncRegistry().catch((error: unknown) => console.warn("Odds registry sync failed", error instanceof Error ? error.message : error));
  // Restore the last quota reading and refresh times so a restart doesn't trigger a burst of priced calls.
  let ready = false;
  void restoreRefreshState().finally(() => { ready = true; });
  const tick = () => {
    if (!ready) return;
    const now = Date.now();
    for (const sport of ODDS_SPORTS) {
      const st = state(sport);
      const demanded = isDemanded(sport, now);
      const interval = autoIntervalMs(sport, now);
      if (!interval) continue;
      if (now - st.lastAttemptAt >= interval) void refreshFeatured(sport);
      if (!demanded || providerMode() !== "the-odds-api") continue;
      for (const [key, slice] of st.slices) {
        const ttl = key.startsWith("game:") ? EVENT_TTL_MS : PROP_TTL_MS;
        if (now - slice.requestedAt < IDLE_MS && now - slice.fetchedAt >= Math.max(throttled() ? THROTTLED_MS : ttl, interval)) {
          void refreshSlice(sport, key, slice.markets, key.startsWith("scan:") ? upcomingGameIds(sport) : slice.gameIds).catch(() => undefined);
        }
        if (now - slice.requestedAt > 6 * 3_600_000) st.slices.delete(key);
      }
    }
  };
  const first = setTimeout(tick, 3000);
  const interval = setInterval(tick, 5000);
  const prune = setInterval(() => {
    void pruneHistory().catch(() => undefined);
    void pruneAlerts().catch(() => undefined);
    void pool.query("DELETE FROM odds_refresh_log WHERE created_at < NOW() - INTERVAL '7 days'").catch(() => undefined);
    void pool.query("DELETE FROM odds_games WHERE commence_time < NOW() - INTERVAL '14 days'").catch(() => undefined);
  }, 3_600_000);
  for (const timer of [first, interval, prune]) timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(interval);
    clearInterval(prune);
    closeAllStreams();
  };
}
