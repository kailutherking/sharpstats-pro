import { pool } from "../db/pool";
import {
  fetchGameDetail, fetchLiveScoreboard, fetchNhlSituations, isInProgress, nhlAbbr,
  type BoxPlayer, type DkLine, type LiveStatus, type ProviderGameDetail, type ProviderLiveGame,
} from "../providers/espnLive";
import { toNumber, type League } from "../providers/espnStats";
import { cached } from "./statsCache";
import { getLeagueStats, NotFoundError, type PlayerRow } from "./stats.service";
import { oddsSnapshot } from "./odds.service";
import { getBooks } from "./oddsCatalog";
import type { Selection } from "./oddsAggregator.service";
import type { OddsGame } from "./oddsTypes";

export const LIVE_REFRESH_SECONDS = 15;
const LIST_TTL_MS = 10_000;
const DETAIL_TTL_MS = 10_000;
const CLOSING_TTL_MS = 5 * 60_000;
const TRACKED_BOOKS = ["fanduel", "draftkings", "betmgm", "caesars", "prizepicks", "underdog", "espnbet", "fanatics"];
export const LIVE_SOURCE = "ESPN scoreboard and game feeds · NHL official API (power play) · The Odds API (sportsbook prices)";

/* ---------- Odds matching ---------- */

const implied = (american: number) => (american > 0 ? 100 / (american + 100) : -american / (-american + 100));

const nickname = (name: string) => name.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().split(/\s+/).slice(-1)[0] ?? "";

/** Finds the odds-board game for an ESPN game: same ID (ESPN odds mode) or same teams within 12 hours. */
export function matchOddsGame(game: Pick<ProviderLiveGame, "id" | "startTime" | "home" | "away">, games: OddsGame[]): OddsGame | null {
  const direct = games.find((item) => item.id === game.id);
  if (direct) return direct;
  const start = new Date(game.startTime).getTime();
  const fits = (oddsName: string, team: ProviderLiveGame["home"]) => {
    const target = nickname(oddsName);
    return target === nickname(team.name) || target === nickname(team.shortName) || oddsName.toLowerCase() === team.name.toLowerCase();
  };
  return games.find((item) => Math.abs(new Date(item.commenceTime).getTime() - start) < 12 * 3_600_000 && fits(item.homeTeam, game.home) && fits(item.awayTeam, game.away)) ?? null;
}

export interface LiveLineSummary {
  source: "multi-book" | "espn" | null;
  books: number;
  updatedAt: string | null;
  moneyline: { home: number | null; away: number | null; homeBook: string | null; awayBook: string | null } | null;
  spread: { homeLine: number | null; homeOdds: number | null; awayLine: number | null; awayOdds: number | null } | null;
  total: { line: number | null; over: number | null; under: number | null } | null;
  /** No-vig home win probability from the moneyline market. */
  marketHomeProbability: number | null;
}

function sideFor(selections: Selection[], market: string, test: (selection: Selection) => boolean) {
  return selections.find((selection) => selection.market === market && test(selection)) ?? null;
}

function teamTest(oddsName: string) {
  return (selection: Selection) => selection.selection === oddsName;
}

export function summarizeLines(oddsGame: OddsGame | null, selections: Selection[], espn: DkLine | null, updatedAt: string | null): LiveLineSummary {
  const mine = oddsGame ? selections.filter((selection) => selection.gameId === oddsGame.id) : [];
  if (oddsGame && mine.length) {
    const mlHome = sideFor(mine, "h2h", teamTest(oddsGame.homeTeam));
    const mlAway = sideFor(mine, "h2h", teamTest(oddsGame.awayTeam));
    const spHome = sideFor(mine, "spreads", teamTest(oddsGame.homeTeam));
    const spAway = sideFor(mine, "spreads", teamTest(oddsGame.awayTeam));
    const over = sideFor(mine, "totals", (selection) => selection.selection === "Over");
    const under = sideFor(mine, "totals", (selection) => selection.selection === "Under");
    const books = new Set(mine.flatMap((selection) => selection.books.filter((price) => price.priced).map((price) => price.book))).size;
    return {
      source: "multi-book",
      books,
      updatedAt,
      moneyline: mlHome || mlAway ? { home: mlHome?.best?.american ?? null, away: mlAway?.best?.american ?? null, homeBook: mlHome?.best?.book ?? null, awayBook: mlAway?.best?.book ?? null } : null,
      spread: spHome || spAway ? { homeLine: spHome?.point ?? null, homeOdds: spHome?.best?.american ?? null, awayLine: spAway?.point ?? null, awayOdds: spAway?.best?.american ?? null } : null,
      total: over || under ? { line: over?.point ?? under?.point ?? null, over: over?.best?.american ?? null, under: under?.best?.american ?? null } : null,
      marketHomeProbability: mlHome?.fair?.probability ?? null,
    };
  }
  if (espn) {
    const homeMl = espn.moneyline?.home ?? null;
    const awayMl = espn.moneyline?.away ?? null;
    const noVig = homeMl !== null && awayMl !== null ? implied(homeMl) / (implied(homeMl) + implied(awayMl)) : null;
    return {
      source: "espn",
      books: 1,
      updatedAt,
      moneyline: espn.moneyline ? { home: espn.moneyline.home, away: espn.moneyline.away, homeBook: "draftkings", awayBook: "draftkings" } : null,
      spread: espn.spread ? { homeLine: espn.spread.home.line, homeOdds: espn.spread.home.odds, awayLine: espn.spread.away.line, awayOdds: espn.spread.away.odds } : null,
      total: espn.total ? { line: espn.total.line, over: espn.total.over, under: espn.total.under } : null,
      marketHomeProbability: noVig,
    };
  }
  return { source: null, books: 0, updatedAt, moneyline: null, spread: null, total: null, marketHomeProbability: null };
}

/* ---------- Views ---------- */

export interface LiveGameView extends ProviderLiveGame {
  statusLabel: string;
  oddsGameId: string | null;
  lines: LiveLineSummary;
  winProbability: { home: number; away: number; source: "ESPN" | "Market (no-vig)" } | null;
}

export function statusLabel(league: League, status: LiveStatus, detail: string): string {
  switch (status) {
    case "pregame": return "Pregame";
    case "halftime": return "Halftime";
    case "end_period": return league === "nhl" ? "End of Period" : league === "mlb" ? detail || "End of inning" : "End of Quarter";
    case "final": return /OT|SO/i.test(detail) ? detail : "Final";
    case "delayed": return detail || "Delayed";
    case "postponed": return detail || "Postponed";
    default: return "Live";
  }
}

function view(game: ProviderLiveGame, oddsGame: OddsGame | null, selections: Selection[], updatedAt: string | null): LiveGameView {
  const lines = summarizeLines(oddsGame, selections, game.espnOdds.current, updatedAt);
  const espnProbability = game.homeWinProbability;
  const probability = game.status === "final"
    ? (game.home.winner ? 1 : game.away.winner ? 0 : null)
    : espnProbability ?? lines.marketHomeProbability;
  return {
    ...game,
    statusLabel: statusLabel(game.league, game.status, game.statusDetail),
    oddsGameId: oddsGame?.id ?? null,
    lines,
    winProbability: probability === null ? null : { home: probability, away: 1 - probability, source: espnProbability !== null || game.status === "final" ? "ESPN" : "Market (no-vig)" },
  };
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  }));
  return results;
}

function detailCached(league: League, eventId: string, force = false) {
  return cached(`live:detail:${league}:${eventId}`, DETAIL_TTL_MS, () => fetchGameDetail(league, eventId), { force });
}

async function applyNhl(games: ProviderLiveGame[]): Promise<void> {
  if (!games.some((game) => isInProgress(game.status))) return;
  const situations = await cached("live:nhl:situations", LIST_TTL_MS, fetchNhlSituations).then((result) => result.data).catch(() => null);
  if (!situations) return;
  for (const game of games) {
    const match = situations.get(`${nhlAbbr(game.away.abbr)}@${nhlAbbr(game.home.abbr)}`);
    if (!match) continue;
    game.home.shots = match.homeShots ?? game.home.shots;
    game.away.shots = match.awayShots ?? game.away.shots;
    if (match.powerPlayAbbr && isInProgress(game.status)) {
      const team = nhlAbbr(game.home.abbr) === match.powerPlayAbbr ? game.home : game.away;
      game.situation.powerPlay = { teamId: team.id, strength: match.strength ?? "PP", timeRemaining: match.timeRemaining };
    }
  }
}

export interface LiveGamesResponse {
  league: League;
  games: LiveGameView[];
  counts: { live: number; pregame: number; final: number };
  fetchedAt: string;
  oddsUpdatedAt: string | null;
  refreshSeconds: number;
  source: string;
  stale: boolean;
}

export async function listLiveGames(league: League, options: { force?: boolean } = {}): Promise<LiveGamesResponse> {
  const board = await cached(`live:list:${league}`, LIST_TTL_MS, async () => {
    const games = await fetchLiveScoreboard(league);
    // Summaries add win probability, timeouts and fouls for games in progress.
    await mapLimit(games.filter((game) => isInProgress(game.status)), 4, async (game) => {
      const detail = await detailCached(league, game.id).catch(() => null);
      if (!detail) return;
      const fresh = detail.data.game;
      Object.assign(game, {
        homeWinProbability: fresh.homeWinProbability ?? game.homeWinProbability,
        situation: { ...game.situation, ...pickDefined(fresh.situation) },
        // The scoreboard drops odds once a game starts; the summary keeps DraftKings' lines.
        espnOdds: game.espnOdds.current ? game.espnOdds : fresh.espnOdds,
      });
      game.home = { ...game.home, timeouts: fresh.home.timeouts, fouls: fresh.home.fouls, inBonus: fresh.home.inBonus, shots: fresh.home.shots ?? game.home.shots };
      game.away = { ...game.away, timeouts: fresh.away.timeouts, fouls: fresh.away.fouls, inBonus: fresh.away.inBonus, shots: fresh.away.shots ?? game.away.shots };
    });
    if (league === "nhl") await applyNhl(games);
    return games;
  }, { force: options.force });
  const odds = await oddsSnapshot(league).catch(() => null);
  const games = board.data
    .map((game) => view(game, odds ? matchOddsGame(game, odds.games) : null, odds?.selections ?? [], odds?.fetchedAt ?? null))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.startTime.localeCompare(b.startTime));
  void persistBoard(league, games);
  return {
    league,
    games,
    counts: {
      live: games.filter((game) => isInProgress(game.status)).length,
      pregame: games.filter((game) => game.status === "pregame").length,
      final: games.filter((game) => game.status === "final").length,
    },
    fetchedAt: board.fetchedAt.toISOString(),
    oddsUpdatedAt: odds?.fetchedAt ?? null,
    refreshSeconds: LIVE_REFRESH_SECONDS,
    source: LIVE_SOURCE,
    stale: board.stale,
  };
}

function pickDefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== false && !(Array.isArray(item) && !item.length))) as Partial<T>;
}

const rank = (status: LiveStatus) => (isInProgress(status) ? 0 : status === "pregame" ? 1 : status === "final" ? 2 : 3);

/* ---------- Game detail ---------- */

export interface BookQuote {
  book: string;
  name: string;
  american: number;
  point: number | null;
  open: { american: number; point: number | null } | null;
  close: { american: number; point: number | null } | null;
  /** Points moved since open (spreads/totals) or implied-probability change (moneyline). */
  moveFromOpen: number | null;
  updatedAt: string | null;
}

export interface MarketSide {
  selectionId: string;
  label: string;
  selection: string;
  point: number | null;
  best: { book: string; american: number } | null;
  fairProbability: number | null;
  books: BookQuote[];
}

export interface MarketView { key: string; label: string; category: string; sides: MarketSide[] }

export interface BookCoverage { key: string; name: string; kind: string; status: "priced" | "props_only" | "no_prices"; prices: number }

export interface LiveOddsPanel {
  oddsGameId: string | null;
  source: "multi-book" | "espn" | null;
  updatedAt: string | null;
  markets: MarketView[];
  periodMarkets: MarketView[];
  props: number;
  coverage: BookCoverage[];
  espn: { current: DkLine | null; open: DkLine | null };
  closingCaptured: boolean;
}


async function closingPrices(sideIds: string[], commenceTime: string): Promise<Map<string, { american: number; point: number | null }>> {
  if (!sideIds.length) return new Map();
  const result = await cached(`live:closing:${sideIds[0]}:${sideIds.length}:${commenceTime}`, CLOSING_TTL_MS, async () => {
    const rows = await pool.query<{ side_id: string; book_key: string; price_american: number; point: string | null }>(
      `SELECT DISTINCT ON (side_id, book_key) side_id, book_key, price_american, point::text
       FROM odds_history WHERE side_id = ANY($1::text[]) AND observed_at <= $2
       ORDER BY side_id, book_key, observed_at DESC`,
      [sideIds, commenceTime],
    );
    return rows.rows.map((row) => [`${row.side_id}|${row.book_key}`, { american: row.price_american, point: row.point === null ? null : Number(row.point) }] as const);
  }).catch(() => null);
  return new Map(result?.data ?? []);
}

function marketViews(selections: Selection[], closing: Map<string, { american: number; point: number | null }>, names: Map<string, string>): MarketView[] {
  const byMarket = new Map<string, MarketView>();
  for (const selection of selections) {
    const market = byMarket.get(selection.market) ?? { key: selection.market, label: selection.marketLabel, category: selection.category, sides: [] };
    byMarket.set(selection.market, market);
    market.sides.push({
      selectionId: selection.id,
      label: selection.label,
      selection: selection.selection,
      point: selection.point,
      best: selection.best ? { book: selection.best.book, american: selection.best.american } : null,
      fairProbability: selection.fair?.probability ?? null,
      books: selection.books.filter((price) => price.priced).map((price) => {
        const open = price.open ? { american: price.open.american, point: price.open.point } : null;
        const moveFromOpen = !open ? null : price.point !== null && open.point !== null && price.point !== open.point
          ? Math.round((price.point - open.point) * 10) / 10
          : Math.round((implied(price.american) - implied(open.american)) * 1000) / 1000;
        return {
          book: price.book, name: names.get(price.book) ?? price.book, american: price.american, point: price.point, open,
          close: closing.get(`${selection.id}|${price.book}`) ?? null, moveFromOpen, updatedAt: price.bookUpdatedAt ?? price.lastSeenAt,
        };
      }),
    });
  }
  return [...byMarket.values()];
}

export async function liveOddsPanel(league: League, game: ProviderLiveGame, pickcenter: ProviderGameDetail["pickcenter"]): Promise<LiveOddsPanel> {
  const odds = await oddsSnapshot(league).catch(() => null);
  const oddsGame = odds ? matchOddsGame(game, odds.games) : null;
  const selections = oddsGame ? odds!.selections.filter((selection) => selection.gameId === oddsGame.id) : [];
  const books = getBooks();
  const names = new Map(books.map((book) => [book.key, book.name]));
  const started = game.status !== "pregame";
  const lineSelections = selections.filter((selection) => selection.category !== "prop");
  const closing = started && oddsGame ? await closingPrices(lineSelections.filter((selection) => selection.category === "game").map((selection) => selection.id), oddsGame.commenceTime) : new Map();
  const counts = new Map<string, { lines: number; props: number }>();
  for (const selection of selections) {
    for (const price of selection.books.filter((item) => item.priced)) {
      const entry = counts.get(price.book) ?? { lines: 0, props: 0 };
      if (selection.category === "prop") entry.props += 1; else entry.lines += 1;
      counts.set(price.book, entry);
    }
  }
  const coverage: BookCoverage[] = TRACKED_BOOKS.map((key) => {
    const book = books.find((item) => item.key === key);
    const count = counts.get(key);
    const status: BookCoverage["status"] = count?.lines ? "priced" : count?.props || book?.kind === "dfs" ? "props_only" : "no_prices";
    return { key, name: book?.name ?? key, kind: book?.kind ?? "sportsbook", status, prices: (count?.lines ?? 0) + (count?.props ?? 0) };
  });
  const all = marketViews(lineSelections, closing, names);
  return {
    oddsGameId: oddsGame?.id ?? null,
    source: selections.length ? "multi-book" : pickcenter.current ? "espn" : null,
    updatedAt: odds?.fetchedAt ?? null,
    markets: all.filter((market) => ["h2h", "spreads", "totals"].includes(market.key)),
    periodMarkets: all.filter((market) => !["h2h", "spreads", "totals"].includes(market.key)),
    props: selections.filter((selection) => selection.category === "prop").length,
    coverage,
    espn: pickcenter,
    closingCaptured: closing.size > 0,
  };
}

export interface LiveGameDetailResponse {
  league: League;
  game: LiveGameView;
  teamStats: ProviderGameDetail["teamStats"];
  box: ProviderGameDetail["box"];
  leaders: ProviderGameDetail["leaders"];
  plays: ProviderGameDetail["plays"];
  winProbability: Array<{ home: number }>;
  odds: LiveOddsPanel;
  fetchedAt: string;
  refreshSeconds: number;
  source: string;
  stale: boolean;
}

/** Keeps a chart-sized win probability series (first, last and evenly spaced points). */
export function sampleSeries<T>(points: T[], max = 120): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => points[Math.round(index * step)]!);
}

export async function getLiveGame(league: League, eventId: string, options: { force?: boolean } = {}): Promise<LiveGameDetailResponse> {
  const detail = await detailCached(league, eventId, options.force).catch((error: unknown) => {
    if (error instanceof Error && /\((400|404)\)|not found/i.test(error.message)) throw new NotFoundError("Game not found");
    throw error;
  });
  const data = detail.data;
  const game = structuredClone(data.game);
  if (league === "nhl") await applyNhl([game]);
  const odds = await liveOddsPanel(league, game, data.pickcenter);
  const snapshot = await oddsSnapshot(league).catch(() => null);
  const gameView = view(game, snapshot ? matchOddsGame(game, snapshot.games) : null, snapshot?.selections ?? [], snapshot?.fetchedAt ?? null);
  void persistDetail(league, gameView, data);
  return {
    league,
    game: gameView,
    teamStats: data.teamStats,
    box: data.box,
    leaders: data.leaders,
    plays: data.plays,
    winProbability: sampleSeries(data.winProbability).map((point) => ({ home: point.home })),
    odds,
    fetchedAt: detail.fetchedAt.toISOString(),
    refreshSeconds: LIVE_REFRESH_SECONDS,
    source: LIVE_SOURCE,
    stale: detail.stale,
  };
}

/* ---------- Live player performance ---------- */

interface PropDef {
  key: string;
  label: string;
  /** Box score group(s) the stat comes from. */
  groups: string[];
  current: (values: Record<string, number | null>) => number | null;
  /** Season per-game average from the Stats dataset. */
  season: (row: PlayerRow) => number | null;
  market: string;
  /** Variance-to-mean ratio of the remaining production (points come in 2s and 3s, yards in chunks). */
  dispersion: number;
}

const v = (key: string) => (values: Record<string, number | null>) => values[key] ?? null;
const sum = (...keys: string[]) => (values: Record<string, number | null>) => (keys.some((key) => values[key] === null || values[key] === undefined) ? null : keys.reduce((total, key) => total + (values[key] ?? 0), 0));
const perGame = (key: string, games: string) => (row: PlayerRow) => {
  const total = row.values[key];
  const count = row.values[games];
  return total === null || total === undefined || !count ? null : total / count;
};
const avg = (key: string) => (row: PlayerRow) => row.values[key] ?? null;

export const PROP_DEFS: Record<League, PropDef[]> = {
  nba: [
    { key: "points", label: "Points", groups: ["players"], current: v("points"), season: avg("pts"), market: "player_points", dispersion: 2.3 },
    { key: "rebounds", label: "Rebounds", groups: ["players"], current: v("rebounds"), season: avg("reb"), market: "player_rebounds", dispersion: 1.3 },
    { key: "assists", label: "Assists", groups: ["players"], current: v("assists"), season: avg("ast"), market: "player_assists", dispersion: 1.4 },
    { key: "threes", label: "3PT made", groups: ["players"], current: v("threePointFieldGoalsMade"), season: avg("tpm"), market: "player_threes", dispersion: 1.2 },
    { key: "pra", label: "Pts + reb + ast", groups: ["players"], current: sum("points", "rebounds", "assists"), season: avg("pra"), market: "player_points_rebounds_assists", dispersion: 2.5 },
    { key: "steals", label: "Steals", groups: ["players"], current: v("steals"), season: avg("stl"), market: "player_steals", dispersion: 1.1 },
    { key: "blocks", label: "Blocks", groups: ["players"], current: v("blocks"), season: avg("blk"), market: "player_blocks", dispersion: 1.1 },
  ],
  nfl: [
    { key: "passYds", label: "Passing yards", groups: ["passing"], current: v("passingYards"), season: perGame("passYds", "gp"), market: "player_pass_yds", dispersion: 22 },
    { key: "passTds", label: "Passing TDs", groups: ["passing"], current: v("passingTouchdowns"), season: perGame("passTd", "gp"), market: "player_pass_tds", dispersion: 1.1 },
    { key: "completions", label: "Completions", groups: ["passing"], current: v("completions"), season: perGame("cmp", "gp"), market: "player_pass_completions", dispersion: 1.5 },
    { key: "rushYds", label: "Rushing yards", groups: ["rushing"], current: v("rushingYards"), season: perGame("rushYds", "gp"), market: "player_rush_yds", dispersion: 18 },
    { key: "rushAtt", label: "Rushing attempts", groups: ["rushing"], current: v("rushingAttempts"), season: perGame("rushAtt", "gp"), market: "player_rush_attempts", dispersion: 1.4 },
    { key: "recYds", label: "Receiving yards", groups: ["receiving"], current: v("receivingYards"), season: perGame("recYds", "gp"), market: "player_reception_yds", dispersion: 20 },
    { key: "receptions", label: "Receptions", groups: ["receiving"], current: v("receptions"), season: perGame("rec", "gp"), market: "player_receptions", dispersion: 1.2 },
  ],
  mlb: [
    { key: "hits", label: "Hits", groups: ["batting"], current: v("hits"), season: perGame("h", "g"), market: "batter_hits", dispersion: 1 },
    { key: "homeRuns", label: "Home runs", groups: ["batting"], current: v("homeRuns"), season: perGame("hr", "g"), market: "batter_home_runs", dispersion: 1 },
    { key: "rbis", label: "RBIs", groups: ["batting"], current: v("RBIs"), season: perGame("rbi", "g"), market: "batter_rbis", dispersion: 1.6 },
    { key: "runs", label: "Runs", groups: ["batting"], current: v("runs"), season: perGame("r", "g"), market: "batter_runs_scored", dispersion: 1.1 },
    { key: "strikeouts", label: "Pitcher strikeouts", groups: ["pitching"], current: v("strikeouts"), season: (row) => perGame("k", "gs")(row) ?? perGame("k", "pg")(row), market: "pitcher_strikeouts", dispersion: 1.1 },
  ],
  nhl: [
    { key: "goals", label: "Goals", groups: ["forwards", "defenses", "skaters"], current: v("goals"), season: perGame("g", "gp"), market: "player_goals", dispersion: 1 },
    { key: "assists", label: "Assists", groups: ["forwards", "defenses", "skaters"], current: v("assists"), season: perGame("a", "gp"), market: "player_assists", dispersion: 1 },
    { key: "points", label: "Points", groups: ["forwards", "defenses", "skaters"], current: sum("goals", "assists"), season: perGame("pts", "gp"), market: "player_points", dispersion: 1.1 },
    { key: "shots", label: "Shots on goal", groups: ["forwards", "defenses", "skaters"], current: v("shotsTotal"), season: perGame("sog", "gp"), market: "player_shots_on_goal", dispersion: 1.1 },
    { key: "saves", label: "Goalie saves", groups: ["goalies"], current: v("saves"), season: perGame("sv", "ggp"), market: "player_total_saves", dispersion: 1.3 },
  ],
};

/** Clock text to minutes remaining: "5:32" → 5.53; NBA's final-minute "45.2" means seconds. */
export function clockMinutes(clock: string | null): number | null {
  if (!clock) return null;
  if (clock.includes(":")) return toNumber(clock);
  const seconds = Number(clock);
  return Number.isFinite(seconds) ? seconds / 60 : null;
}

/** Share of the game already played (0–1), from the period and clock. */
export function gameProgress(game: Pick<ProviderLiveGame, "league" | "status" | "period" | "clock" | "statusDetail" | "situation">): number {
  if (game.status === "final") return 1;
  if (game.status === "pregame" || game.period <= 0) return 0;
  if (game.league === "mlb") {
    const detail = game.statusDetail.toLowerCase();
    const inning = game.period;
    const outs = game.situation.outs ?? 0;
    let halves = (inning - 1) * 2;
    let partial = outs / 3;
    if (/^(mid|middle)/.test(detail)) { halves += 1; partial = 0; }
    else if (/^end/.test(detail)) { halves += 2; partial = 0; }
    else if (/^bot/.test(detail)) halves += 1;
    return Math.min(0.99, (halves + partial) / 18);
  }
  const [periodLength, regulationPeriods, overtimeLength] = game.league === "nba" ? [12, 4, 5] : game.league === "nfl" ? [15, 4, 10] : [20, 3, 5];
  const regulation = periodLength * regulationPeriods;
  const inOvertime = game.period > regulationPeriods;
  const length = inOvertime ? overtimeLength : periodLength;
  const before = inOvertime ? regulation + (game.period - regulationPeriods - 1) * overtimeLength : (game.period - 1) * periodLength;
  const remaining = game.status === "halftime" || game.status === "end_period" ? 0 : clockMinutes(game.clock) ?? length;
  const elapsed = before + Math.max(0, length - Math.min(length, remaining));
  const total = inOvertime ? regulation + (game.period - regulationPeriods) * overtimeLength : regulation;
  return Math.max(0, Math.min(game.status === "end_period" && !inOvertime && game.period >= regulationPeriods ? 1 : 0.995, elapsed / total));
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function poissonAtLeast(lambda: number, k: number): number {
  if (k <= 0) return 1;
  let term = Math.exp(-lambda);
  let cumulative = term;
  for (let i = 1; i < k; i += 1) {
    term *= lambda / i;
    cumulative += term;
  }
  return Math.max(0, Math.min(1, 1 - cumulative));
}

/** Probability that remaining production (mean `lambda`) pushes `current` over `line`. */
export function overProbability(current: number, line: number, lambda: number, dispersion: number): number {
  const needed = Math.floor(line - current) + 1;
  if (needed <= 0) return 1;
  if (lambda <= 0) return 0;
  if (dispersion <= 1.2 && lambda < 25) return poissonAtLeast(lambda, needed);
  const sd = Math.sqrt(lambda * dispersion);
  return 1 - normalCdf((needed - 0.5 - lambda) / sd);
}

export interface Projection { projected: number; remaining: number; pace: number | null; seasonAverage: number | null }

/**
 * Projected finish: current production plus the expected rest of the game. The per-game rate
 * blends the player's season average with tonight's pace, trusting tonight more as the game goes on.
 * NBA uses minutes: the remaining minutes are the season minutes-per-game share still to be played.
 */
export function projectStat(input: { current: number; seasonAverage: number | null; progress: number; minutesPlayed?: number | null; seasonMinutes?: number | null; final?: boolean }): Projection {
  const { current, seasonAverage, progress } = input;
  if (input.final || progress >= 1) return { projected: current, remaining: 0, pace: current, seasonAverage };
  const pace = progress > 0.05 ? current / progress : null;
  if (input.seasonMinutes && input.minutesPlayed !== undefined && input.minutesPlayed !== null && seasonAverage !== null) {
    const seasonPerMinute = seasonAverage / input.seasonMinutes;
    const gamePerMinute = input.minutesPlayed > 0 ? current / input.minutesPlayed : seasonPerMinute;
    const weight = input.minutesPlayed / (input.minutesPlayed + 12);
    const perMinute = weight * gamePerMinute + (1 - weight) * seasonPerMinute;
    const remainingMinutes = Math.max(0, input.seasonMinutes * (1 - progress));
    const remaining = perMinute * remainingMinutes;
    return { projected: current + remaining, remaining, pace, seasonAverage };
  }
  const rate = seasonAverage === null ? pace ?? 0 : pace === null ? seasonAverage : progress * pace + (1 - progress) * seasonAverage;
  const remaining = Math.max(0, rate * (1 - progress));
  return { projected: current + remaining, remaining, pace, seasonAverage };
}

export interface PlayerPropTrack {
  key: string;
  label: string;
  current: number | null;
  seasonAverage: number | null;
  projected: number | null;
  pace: number | null;
  line: number | null;
  lineSource: string | null;
  overPrice: number | null;
  underPrice: number | null;
  hitProbability: number | null;
  overProgress: number | null;
  underCushion: number | null;
  needed: number | null;
}

export interface LivePlayerResponse {
  league: League;
  gameId: string;
  player: { id: string; name: string; position: string; headshot: string | null; teamId: string; teamAbbr: string; starter: boolean };
  game: Pick<LiveGameView, "id" | "shortName" | "status" | "statusLabel" | "clock" | "periodLabel">;
  progress: number;
  stats: Array<{ group: string; label: string; display: Record<string, string> }>;
  props: PlayerPropTrack[];
  propsLoaded: boolean;
  fetchedAt: string;
}

const normalizeName = (name: string) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z]/g, "");

export async function getLivePlayer(league: League, eventId: string, playerId: string, overrides: { stat?: string; line?: number } = {}): Promise<LivePlayerResponse> {
  const detail = await detailCached(league, eventId).catch(() => { throw new NotFoundError("Game not found"); });
  const data = detail.data;
  const appearances = data.box.flatMap((team) => team.groups.flatMap((group) => group.players.filter((player) => player.id === playerId).map((player) => ({ team, group, player }))));
  if (!appearances.length) throw new NotFoundError("This player has no box score line in this game yet.");
  const first = appearances[0]!;
  const teamAbbr = first.team.teamId === data.game.home.id ? data.game.home.abbr : data.game.away.abbr;
  const values: Record<string, number | null> = {};
  for (const appearance of appearances) Object.assign(values, appearance.player.values);
  const groups = new Set(appearances.map((appearance) => appearance.group.key));
  const progress = gameProgress(data.game);
  const final = data.game.status === "final";
  const season = await getLeagueStats(league, "season").then((stats) => stats.players.find((row) => row.id === playerId) ?? null).catch(() => null);
  const odds = await oddsSnapshot(league).catch(() => null);
  const oddsGame = odds ? matchOddsGame(data.game, odds.games) : null;
  const target = normalizeName(first.player.name);
  const props = oddsGame ? odds!.selections.filter((selection) => selection.gameId === oddsGame.id && selection.category === "prop" && normalizeName(selection.participant) === target) : [];
  const names = new Map(getBooks().map((book) => [book.key, book.name]));
  const minutesPlayed = league === "nba" ? values.minutes ?? null : null;
  const seasonMinutes = league === "nba" ? season?.values.min ?? null : null;

  const tracks = PROP_DEFS[league].filter((def) => def.groups.some((group) => groups.has(group))).map((def): PlayerPropTrack => {
    const current = def.current(values);
    const seasonAverage = season ? def.season(season) : null;
    const over = props.find((selection) => selection.market === def.market && selection.selection === "Over");
    const under = props.find((selection) => selection.market === def.market && selection.selection === "Under");
    const custom = overrides.stat === def.key && overrides.line !== undefined ? overrides.line : null;
    const line = custom ?? over?.point ?? under?.point ?? null;
    const lineSource = custom !== null ? "Custom" : over?.best ? names.get(over.best.book) ?? over.best.book : null;
    if (current === null) {
      return { key: def.key, label: def.label, current: null, seasonAverage, projected: null, pace: null, line, lineSource, overPrice: over?.best?.american ?? null, underPrice: under?.best?.american ?? null, hitProbability: null, overProgress: null, underCushion: null, needed: null };
    }
    const projection = projectStat({ current, seasonAverage, progress, minutesPlayed, seasonMinutes, final });
    const hitProbability = line === null ? null : final ? (current > line ? 1 : 0) : overProbability(current, line, projection.remaining, def.dispersion);
    return {
      key: def.key, label: def.label, current, seasonAverage, projected: Math.round(projection.projected * 10) / 10, pace: projection.pace === null ? null : Math.round(projection.pace * 10) / 10,
      line, lineSource, overPrice: over?.best?.american ?? null, underPrice: under?.best?.american ?? null,
      hitProbability: hitProbability === null ? null : Math.round(hitProbability * 1000) / 1000,
      overProgress: line ? Math.min(1, current / line) : null,
      underCushion: line ? Math.max(0, (line - current) / line) : null,
      needed: line === null ? null : Math.max(0, Math.floor(line - current) + 1),
    };
  });

  const gameView = view(data.game, oddsGame, odds?.selections ?? [], odds?.fetchedAt ?? null);
  return {
    league,
    gameId: eventId,
    player: { id: playerId, name: first.player.name, position: first.player.position || season?.position || "", headshot: first.player.headshot ?? season?.headshot ?? null, teamId: first.team.teamId, teamAbbr, starter: first.player.starter },
    game: { id: gameView.id, shortName: gameView.shortName, status: gameView.status, statusLabel: gameView.statusLabel, clock: gameView.clock, periodLabel: gameView.periodLabel },
    progress,
    stats: appearances.map((appearance) => ({ group: appearance.group.key, label: appearance.group.label, display: appearance.player.display })),
    props: tracks,
    propsLoaded: props.length > 0,
    fetchedAt: detail.fetchedAt.toISOString(),
  };
}

/* ---------- Persistence (best effort; never blocks a response) ---------- */

const lastScore = new Map<string, string>();
const lastOdds = new Map<string, string>();
const lastBox = new Map<string, string>();

async function persistBoard(league: League, games: LiveGameView[]): Promise<void> {
  if (!games.length) return;
  try {
    await pool.query(
      `INSERT INTO games(league, event_id, name, short_name, start_time, status, status_detail, home_team_id, away_team_id, home_team, away_team, home_abbr, away_abbr, odds_game_id, updated_at)
       SELECT *, NOW() FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::text[])
       ON CONFLICT (league, event_id) DO UPDATE SET status=EXCLUDED.status, status_detail=EXCLUDED.status_detail, start_time=EXCLUDED.start_time,
         odds_game_id=COALESCE(EXCLUDED.odds_game_id, games.odds_game_id), updated_at=NOW()`,
      [games.map(() => league), games.map((g) => g.id), games.map((g) => g.name), games.map((g) => g.shortName), games.map((g) => g.startTime), games.map((g) => g.status),
        games.map((g) => g.statusDetail), games.map((g) => g.home.id), games.map((g) => g.away.id), games.map((g) => g.home.name), games.map((g) => g.away.name),
        games.map((g) => g.home.abbr), games.map((g) => g.away.abbr), games.map((g) => g.oddsGameId)],
    );
    const scores = games.filter((game) => game.status !== "pregame").filter((game) => {
      const signature = [game.status, game.period, game.clock, game.home.score, game.away.score, game.situation.down, game.situation.outs, game.situation.possessionTeamId].join("|");
      const key = `${league}:${game.id}`;
      if (lastScore.get(key) === signature) return false;
      lastScore.set(key, signature);
      return true;
    });
    if (scores.length) {
      await pool.query(
        `INSERT INTO live_scores(league, event_id, status, period, clock, home_score, away_score, possession_team_id, home_win_probability, situation)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::text[], $6::int[], $7::int[], $8::text[], $9::numeric[], $10::jsonb[])`,
        [scores.map(() => league), scores.map((g) => g.id), scores.map((g) => g.status), scores.map((g) => g.period), scores.map((g) => g.clock), scores.map((g) => g.home.score),
          scores.map((g) => g.away.score), scores.map((g) => g.situation.possessionTeamId), scores.map((g) => g.winProbability?.home ?? null), scores.map((g) => JSON.stringify(g.situation))],
      );
    }
    const odds = games.filter((game) => isInProgress(game.status) && game.lines.source).flatMap((game) => {
      const rows: Array<[string, string, number | null, number | null]> = [];
      const { moneyline, spread, total } = game.lines;
      if (moneyline) rows.push(["h2h", "home", null, moneyline.home], ["h2h", "away", null, moneyline.away]);
      if (spread) rows.push(["spreads", "home", spread.homeLine, spread.homeOdds], ["spreads", "away", spread.awayLine, spread.awayOdds]);
      if (total) rows.push(["totals", "over", total.line, total.over], ["totals", "under", total.line, total.under]);
      return rows.filter((row) => row[3] !== null).map(([market, side, point, american]) => ({ game, market, side, point, american: american!, source: game.lines.source! }));
    }).filter((row) => {
      const key = `${league}:${row.game.id}:${row.market}:${row.side}`;
      const signature = `${row.point}|${row.american}`;
      if (lastOdds.get(key) === signature) return false;
      lastOdds.set(key, signature);
      return true;
    });
    if (odds.length) {
      await pool.query(
        `INSERT INTO live_odds_snapshots(league, event_id, odds_game_id, market_key, side, point, price_american, source)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::int[], $8::text[])`,
        [odds.map(() => league), odds.map((row) => row.game.id), odds.map((row) => row.game.oddsGameId), odds.map((row) => row.market), odds.map((row) => row.side),
          odds.map((row) => row.point), odds.map((row) => row.american), odds.map((row) => row.source)],
      );
    }
  } catch (error) {
    console.warn("Live game write failed", error instanceof Error ? error.message : error);
  }
}

async function persistDetail(league: League, game: LiveGameView, detail: ProviderGameDetail): Promise<void> {
  if (game.status === "pregame") return;
  const rows = detail.box.flatMap((team) => team.groups.flatMap((group) => group.players.filter((player: BoxPlayer) => !player.didNotPlay).map((player) => ({ team, group, player }))));
  const signature = JSON.stringify(rows.map((row) => row.player.display));
  const key = `${league}:${game.id}`;
  if (!rows.length || lastBox.get(key) === signature) return;
  lastBox.set(key, signature);
  try {
    await pool.query(
      `INSERT INTO player_game_stats(league, event_id, player_id, stat_group, team_id, player_name, position, stats, updated_at)
       SELECT *, NOW() FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::jsonb[])
       ON CONFLICT (league, event_id, player_id, stat_group) DO UPDATE SET stats=EXCLUDED.stats, updated_at=NOW()`,
      [rows.map(() => league), rows.map(() => game.id), rows.map((row) => row.player.id), rows.map((row) => row.group.key), rows.map((row) => row.team.teamId),
        rows.map((row) => row.player.name), rows.map((row) => row.player.position), rows.map((row) => JSON.stringify(row.player.values))],
    );
  } catch (error) {
    console.warn("Player game stats write failed", error instanceof Error ? error.message : error);
  }
}
