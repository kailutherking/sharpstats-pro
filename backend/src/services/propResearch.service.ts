import type { ProviderGame } from "../providers/espnStats";
import { getLeagueDirectory, getPlayerGames, type LeagueDirectory } from "./stats.service";
import { marketDef, type OddsSport } from "./oddsCatalog";
import type { BookPrice, Selection } from "./odds.aggregate.service";
import type { OddsGame } from "./oddsTypes";

/**
 * Player prop research: joins sportsbook prop lines to the stats platform's game logs (same ESPN
 * athlete data as the Stats section) and computes hit rates against the current line.
 */

type Values = Record<string, number | null>;
type StatFn = (values: Values) => number | null;

const v = (key: string): StatFn => (values) => values[key] ?? null;
const sum = (...keys: string[]): StatFn => (values) => {
  const parts = keys.map((key) => values[key]);
  return parts.some((part) => part === null || part === undefined) ? null : (parts as number[]).reduce((a, b) => a + b, 0);
};
/** Weighted sum where missing categories count as zero, as long as at least one is present. */
const weighted = (weights: Record<string, number>): StatFn => (values) => {
  let present = false;
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const value = values[key];
    if (value === null || value === undefined) continue;
    present = true;
    total += value * weight;
  }
  return present ? Math.round(total * 100) / 100 : null;
};
const doubleCount = (values: Values) => ["points", "totalRebounds", "assists", "steals", "blocks"].filter((key) => (values[key] ?? 0) >= 10).length;

/** Fantasy formulas follow PrizePicks scoring, the pick'em book that posts most fantasy-score lines. */
export const PROP_STATS: Record<string, StatFn> = {
  "nba.points": v("points"),
  "nba.rebounds": v("totalRebounds"),
  "nba.assists": v("assists"),
  "nba.threes": v("threePointFieldGoalsMade"),
  "nba.pr": sum("points", "totalRebounds"),
  "nba.pa": sum("points", "assists"),
  "nba.ra": sum("totalRebounds", "assists"),
  "nba.pra": sum("points", "totalRebounds", "assists"),
  "nba.steals": v("steals"),
  "nba.blocks": v("blocks"),
  "nba.turnovers": v("turnovers"),
  "nba.doubleDouble": (values) => values.points === undefined ? null : doubleCount(values) >= 2 ? 1 : 0,
  "nba.tripleDouble": (values) => values.points === undefined ? null : doubleCount(values) >= 3 ? 1 : 0,
  "nba.fantasy": weighted({ points: 1, totalRebounds: 1.2, assists: 1.5, steals: 3, blocks: 3, turnovers: -1 }),
  "nba.minutes": v("minutes"),
  "nfl.passYds": v("passingYards"),
  "nfl.passTds": v("passingTouchdowns"),
  "nfl.passAtt": v("passingAttempts"),
  "nfl.completions": v("completions"),
  "nfl.interceptions": v("interceptions"),
  "nfl.rushYds": v("rushingYards"),
  "nfl.rushAtt": v("rushingAttempts"),
  "nfl.recYds": v("receivingYards"),
  "nfl.receptions": v("receptions"),
  "nfl.longRec": v("longReception"),
  "nfl.anytimeTd": (values) => {
    const rushing = values.rushingTouchdowns;
    const receiving = values.receivingTouchdowns;
    if ((rushing === null || rushing === undefined) && (receiving === null || receiving === undefined)) return null;
    return (rushing ?? 0) + (receiving ?? 0) > 0 ? 1 : 0;
  },
  "nfl.fantasy": weighted({ passingYards: 0.04, passingTouchdowns: 4, interceptions: -1, rushingYards: 0.1, rushingTouchdowns: 6, receptions: 1, receivingYards: 0.1, receivingTouchdowns: 6, fumblesLost: -1 }),
  "mlb.hits": v("hits"),
  "mlb.runs": v("runs"),
  "mlb.rbis": v("RBIs"),
  "mlb.homeRuns": v("homeRuns"),
  "mlb.totalBases": (values) => {
    const hits = values.hits;
    if (hits === null || hits === undefined) return null;
    return hits + (values.doubles ?? 0) + 2 * (values.triples ?? 0) + 3 * (values.homeRuns ?? 0);
  },
  "mlb.singles": (values) => {
    const hits = values.hits;
    if (hits === null || hits === undefined) return null;
    return hits - (values.doubles ?? 0) - (values.triples ?? 0) - (values.homeRuns ?? 0);
  },
  "mlb.doubles": v("doubles"),
  "mlb.strikeouts": v("strikeouts"),
  "mlb.outs": (values) => values.innings === null || values.innings === undefined ? null : Math.round(values.innings * 3),
  "mlb.earnedRuns": v("earnedRuns"),
  "mlb.walks": v("walks"),
  "mlb.fantasy": (values) => {
    const hits = values.hits;
    if (hits === null || hits === undefined) return null;
    const singles = hits - (values.doubles ?? 0) - (values.triples ?? 0) - (values.homeRuns ?? 0);
    return 3 * singles + 5 * (values.doubles ?? 0) + 8 * (values.triples ?? 0) + 10 * (values.homeRuns ?? 0)
      + 2 * (values.runs ?? 0) + 2 * (values.RBIs ?? 0) + 2 * (values.walks ?? 0) + 2 * (values.hitByPitch ?? 0) + 5 * (values.stolenBases ?? 0);
  },
  "nhl.goals": v("goals"),
  "nhl.assists": v("assists"),
  "nhl.points": v("points"),
  "nhl.shots": v("shotsTotal"),
  "nhl.blockedShots": v("blockedShots"),
  "nhl.ppp": sum("powerPlayGoals", "powerPlayAssists"),
  "nhl.saves": v("saves"),
  "nhl.savePct": v("savePct"),
};

export function normalizeName(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’`-]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface HitRateWindow { hits: number; games: number; rate: number | null }

export interface PropResearch {
  playerId: string;
  headshot: string | null;
  team: string;
  opponent: string | null;
  line: number;
  l5: HitRateWindow;
  l10: HitRateWindow;
  season: HitRateWindow;
  home: HitRateWindow;
  away: HitRateWindow;
  vsOpponent: HitRateWindow;
  averageL10: number | null;
  averageSeason: number | null;
  recent: number[];
}

export function hitWindow(values: number[], line: number): HitRateWindow {
  const hits = values.filter((value) => value > line).length;
  return { hits, games: values.length, rate: values.length ? hits / values.length : null };
}

const mean = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : null;

export function researchFromGames(games: ProviderGame[], stat: StatFn, line: number, opponentAbbr: string | null): Omit<PropResearch, "playerId" | "headshot" | "team" | "opponent" | "line"> {
  const rows = games
    .map((game) => ({ game, value: stat(game.values) }))
    .filter((row): row is { game: ProviderGame; value: number } => row.value !== null && Number.isFinite(row.value));
  const values = rows.map((row) => row.value);
  return {
    l5: hitWindow(values.slice(0, 5), line),
    l10: hitWindow(values.slice(0, 10), line),
    season: hitWindow(values, line),
    home: hitWindow(rows.filter((row) => row.game.home).map((row) => row.value), line),
    away: hitWindow(rows.filter((row) => !row.game.home).map((row) => row.value), line),
    vsOpponent: hitWindow(opponentAbbr ? rows.filter((row) => row.game.opponentAbbr === opponentAbbr).map((row) => row.value) : [], line),
    averageL10: mean(values.slice(0, 10)),
    averageSeason: mean(values),
    recent: values.slice(0, 10),
  };
}

export interface PropSide {
  selectionId: string;
  best: Selection["best"];
  average: Selection["average"];
  fair: Selection["fair"];
  ev: number | null;
  tier: Selection["tier"];
  books: Array<Pick<BookPrice, "book" | "american" | "point" | "atLine" | "isBest" | "priced" | "probabilityMove" | "pointMove" | "open" | "lastChangeAt">>;
  signals: Selection["signals"];
}

export interface PropRow {
  id: string;
  gameId: string;
  game: string;
  commenceTime: string | null;
  status: OddsGame["status"] | null;
  sport: OddsSport;
  market: string;
  marketLabel: string;
  type: Selection["type"];
  player: string;
  line: number | null;
  over: PropSide | null;
  under: PropSide | null;
  books: string[];
  openLine: number | null;
  lineMove: number | null;
  research: PropResearch | null;
  updatedAt: string;
}

function side(selection: Selection | undefined): PropSide | null {
  if (!selection) return null;
  return {
    selectionId: selection.id,
    best: selection.best,
    average: selection.average,
    fair: selection.fair,
    ev: selection.ev,
    tier: selection.tier,
    books: selection.books.map(({ book, american, point, atLine, isBest, priced, probabilityMove, pointMove, open, lastChangeAt }) => ({ book, american, point, atLine, isBest, priced, probabilityMove, pointMove, open, lastChangeAt })),
    signals: selection.signals,
  };
}

/** Groups Over/Under (or Yes/No) selections into one row per player market. */
export function buildPropRows(selections: Selection[], games: Map<string, OddsGame>): PropRow[] {
  const byPair = new Map<string, Selection[]>();
  for (const selection of selections) {
    if (selection.category !== "prop") continue;
    byPair.set(selection.pairId, [...(byPair.get(selection.pairId) ?? []), selection]);
  }
  const rows: PropRow[] = [];
  for (const [pairId, pair] of byPair) {
    const over = pair.find((item) => /^(over|yes)$/i.test(item.selection));
    const under = pair.find((item) => /^(under|no)$/i.test(item.selection));
    const first = over ?? under ?? pair[0]!;
    const game = games.get(first.gameId);
    const reference = (over ?? under)?.books.find((price) => price.atLine && price.open && price.open.point !== null);
    rows.push({
      id: pairId,
      gameId: first.gameId,
      game: game ? `${game.awayTeam} @ ${game.homeTeam}` : "",
      commenceTime: game?.commenceTime ?? null,
      status: game?.status ?? null,
      sport: first.sport,
      market: first.market,
      marketLabel: first.marketLabel,
      type: first.type,
      player: first.participant,
      line: first.type === "prop_yes" ? 0.5 : first.point,
      over: side(over),
      under: side(under),
      books: [...new Set(pair.flatMap((item) => item.books.map((price) => price.book)))],
      openLine: reference?.open?.point ?? null,
      lineMove: reference?.pointMove ?? null,
      research: null,
      updatedAt: pair.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, ""),
    });
  }
  return rows.sort((a, b) => (a.commenceTime ?? "").localeCompare(b.commenceTime ?? "") || a.player.localeCompare(b.player) || a.market.localeCompare(b.market));
}

function teamMatches(team: LeagueDirectory["teams"][number], name: string, abbr: string | null): boolean {
  if (abbr && team.abbr.toLowerCase() === abbr.toLowerCase()) return true;
  const target = normalizeName(name);
  const full = normalizeName(team.name);
  const nickname = normalizeName(team.shortName);
  return full === target || (nickname.length > 2 && target.endsWith(` ${nickname}`));
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]!;
      await worker(item);
    }
  }));
}

/** Attaches hit-rate research to the first `limit` rows (provider-friendly; logs are cached by the stats service). */
export async function attachResearch(sport: OddsSport, rows: PropRow[], games: Map<string, OddsGame>, limit: number): Promise<{ researched: number; unmatched: number }> {
  let directory: LeagueDirectory;
  try {
    directory = await getLeagueDirectory(sport);
  } catch {
    return { researched: 0, unmatched: rows.length };
  }
  const byName = new Map<string, LeagueDirectory["players"]>();
  for (const player of directory.players) {
    const key = normalizeName(player.name);
    byName.set(key, [...(byName.get(key) ?? []), player]);
  }
  let researched = 0;
  let unmatched = 0;
  await pool(rows.slice(0, limit), 6, async (row) => {
    const def = marketDef(sport, row.market);
    const stat = def?.stat ? PROP_STATS[def.stat] : undefined;
    const line = row.line;
    if (!stat || line === null) return;
    const game = games.get(row.gameId);
    const candidates = byName.get(normalizeName(row.player)) ?? [];
    const gameTeams = game ? directory.teams.filter((team) => teamMatches(team, game.homeTeam, game.homeAbbr) || teamMatches(team, game.awayTeam, game.awayAbbr)) : [];
    const player = candidates.find((candidate) => gameTeams.some((team) => team.id === candidate.teamId)) ?? candidates[0];
    if (!player) {
      unmatched += 1;
      return;
    }
    const opponent = gameTeams.find((team) => team.id !== player.teamId) ?? null;
    const groupKey = sport === "mlb" ? (row.market.startsWith("pitcher_") ? "pitching" : "batting") : undefined;
    try {
      const log = await getPlayerGames(sport, player.id, groupKey);
      row.research = {
        playerId: player.id,
        headshot: player.headshot,
        team: player.teamAbbr,
        opponent: opponent?.abbr ?? null,
        line,
        ...researchFromGames(log, stat, line, opponent?.abbr ?? null),
      };
      researched += 1;
    } catch {
      // Research is best-effort; the line itself still displays.
    }
  });
  return { researched, unmatched };
}
