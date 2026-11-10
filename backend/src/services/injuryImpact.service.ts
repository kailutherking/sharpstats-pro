/**
 * Injury betting impact engine.
 *
 * Each injured player's season production (from the Stats dataset) is converted into an estimated
 * change in team strength per game, in the league's scoring unit, against a replacement-level
 * fill-in. Status sets how much of that applies (Out = all, Questionable = 40%). These are
 * transparent rules of thumb, not a trained model; the inputs and formulas are returned as `basis`.
 */
import { pool } from "../db/pool";
import type { InjuryStatus } from "../providers/espnInjuries";
import type { League } from "../providers/espnStats";
import type { PlayerRow } from "./stats.service";
import { getBooks } from "./oddsCatalog";

export type ImpactTier = "Elite" | "High" | "Moderate" | "Low" | "Minimal";
export type ImpactLevel = "Very High" | "High" | "Moderate" | "Low" | "None";

export const STATUS_WEIGHT: Record<InjuryStatus, number> = {
  Out: 1, "Injured Reserve": 1, Suspended: 1, Inactive: 1, Doubtful: 0.75, "Game Time Decision": 0.5, Questionable: 0.4, "Day-to-Day": 0.3, Probable: 0.1, Active: 0,
};

/** League scoring unit, the rating change treated as elite, and win probability per unit. */
const SCALE: Record<League, { unit: string; elite: number; winPerUnit: number }> = {
  nba: { unit: "pts", elite: 6, winPerUnit: 0.028 },
  nfl: { unit: "pts", elite: 4.5, winPerUnit: 0.03 },
  mlb: { unit: "runs", elite: 0.35, winPerUnit: 0.1 },
  nhl: { unit: "goals", elite: 0.3, winPerUnit: 0.2 },
};

export interface Beneficiary { id: string; name: string; position: string; stat: string; value: number }

export interface InjuryImpact {
  importance: number;
  tier: ImpactTier;
  statusWeight: number;
  projectedImpact: number;
  /** Team rating change per game while the player is out (negative = weaker), in `ratingUnit`. */
  ratingChange: number;
  /** Status-weighted rating change for the next game. */
  expectedRatingChange: number;
  ratingUnit: string;
  winImpact: number;
  offensive: { change: number; level: ImpactLevel };
  defensive: { change: number; level: ImpactLevel };
  fantasy: { perGame: number | null; percentile: number | null; level: ImpactLevel };
  prop: { level: ImpactLevel; markets: string[]; beneficiaries: Beneficiary[] };
  basis: string;
  hasStats: boolean;
}

const val = (row: PlayerRow | null | undefined, key: string) => row?.values[key] ?? null;
const perGame = (row: PlayerRow, key: string, games: string) => {
  const total = val(row, key);
  const count = val(row, games);
  return total === null || !count ? 0 : total / count;
};
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

interface Split { offense: number; defense: number; basis: string }

/** Rating change (positive = how much the team loses) split into offense and defense. */
export function playerValue(league: League, row: PlayerRow | null, position: string): Split {
  const pos = position.toUpperCase();
  if (!row) {
    const defaults: Record<string, number> = league === "nfl" ? { QB: 0.3, OT: 0.45, G: 0.35, C: 0.35, OL: 0.4, K: 0.3, P: 0.1, LS: 0.05 } : {};
    const offense = defaults[pos] ?? 0.1 * (SCALE[league].elite / 6);
    return { offense, defense: 0, basis: "No current-season statistics: position default applied." };
  }
  if (league === "nba") {
    const pts = val(row, "pts") ?? 0, reb = val(row, "reb") ?? 0, ast = val(row, "ast") ?? 0, stl = val(row, "stl") ?? 0, blk = val(row, "blk") ?? 0, tov = val(row, "tov") ?? 0;
    const total = pts + 1.2 * reb + 1.5 * ast + 2 * stl + 2 * blk - tov;
    const above = Math.max(0, total - 12) * 0.165;
    const offenseShare = total > 0 ? clamp((pts + 1.5 * ast - tov) / total, 0, 1) : 0.6;
    return { offense: above * offenseShare, defense: above * (1 - offenseShare), basis: `Game score ${round(total, 1)} per game (PTS + 1.2·REB + 1.5·AST + 2·STL + 2·BLK − TO) vs 12 replacement level × 0.165 pts.` };
  }
  if (league === "nfl") {
    const gp = val(row, "gp") || 1;
    if (pos === "QB" || (val(row, "att") ?? 0) / gp >= 10) {
      const yards = perGame(row, "passYds", "gp"), tds = perGame(row, "passTd", "gp"), ints = perGame(row, "int", "gp");
      const loss = clamp((yards - 170) / 25 + (tds - 0.8) * 2.5 - (ints - 0.8) * 1.5, 0, 7);
      return { offense: loss, defense: 0, basis: `${round(yards, 0)} pass yds, ${round(tds, 1)} TD and ${round(ints, 1)} INT per game vs a 170-yard backup.` };
    }
    const scrimmage = perGame(row, "rushYds", "gp") + perGame(row, "recYds", "gp");
    const tds = perGame(row, "rushTd", "gp") + perGame(row, "recTd", "gp");
    if (scrimmage > 10) {
      const factor = pos === "RB" ? 0.6 : 0.7;
      const loss = clamp(((scrimmage - 30) / 38 + tds) * factor, 0, 2.5);
      return { offense: loss, defense: 0, basis: `${round(scrimmage, 0)} scrimmage yds and ${round(tds, 2)} TD per game.` };
    }
    const defense = clamp(perGame(row, "tackles", "gp") * 0.06 + perGame(row, "sacks", "gp") * 1.5 + perGame(row, "defInt", "gp") * 2 + perGame(row, "pd", "gp") * 0.3, 0, 2);
    return { offense: 0, defense, basis: `Per game: ${round(perGame(row, "tackles", "gp"), 1)} tackles, ${round(perGame(row, "sacks", "gp"), 2)} sacks, ${round(perGame(row, "defInt", "gp"), 2)} INT.` };
  }
  if (league === "mlb") {
    if ((val(row, "pg") ?? 0) > 0 && (val(row, "ab") ?? 0) < 20) {
      const starts = val(row, "gs") ?? 0;
      const appearances = val(row, "pg") || 1;
      const era = val(row, "era") ?? 4.6;
      const ip = val(row, "ip") ?? 0;
      if (starts >= 3 && starts / appearances >= 0.5) {
        const perStart = ip / appearances;
        const loss = clamp((4.6 - era) * perStart / 9 * 0.4, 0, 0.6);
        return { offense: 0, defense: loss, basis: `${round(era)} ERA over ${round(perStart, 1)} innings per start vs a 4.60 ERA replacement (applies on days he starts).` };
      }
      // Relievers pitch in under half of games, so their per-game effect is halved.
      const loss = clamp(((4.3 - era) * (ip / appearances) / 9 + (val(row, "sv") ?? 0) / appearances * 0.05) * 0.5, 0, 0.15);
      return { offense: 0, defense: loss, basis: `Reliever: ${round(era)} ERA, ${val(row, "sv") ?? 0} saves.` };
    }
    const ops = val(row, "ops") ?? 0.68;
    const abPerGame = perGame(row, "ab", "g");
    const loss = clamp((ops - 0.68) * 1.4 * (abPerGame / 4), 0, 0.5);
    return { offense: loss, defense: 0, basis: `${ops.toFixed(3)} OPS with ${round(abPerGame, 1)} AB per game vs a .680 OPS replacement.` };
  }
  // NHL
  if (pos === "G") {
    const sv = val(row, "svPct") ?? 0.9;
    const share = clamp((val(row, "ggp") ?? 0) / 40, 0.25, 1);
    const loss = clamp((sv - 0.9) * 28 * share, 0, 0.8);
    return { offense: 0, defense: loss, basis: `${sv.toFixed(3)} save % vs a .900 backup on ~28 shots a game.` };
  }
  const ppg = perGame(row, "pts", "gp");
  const toi = val(row, "toi") ?? 14;
  const offense = clamp((ppg - 0.35) * 0.35, 0, 0.45);
  const defense = pos === "D" ? clamp((toi - 18) / 10 * 0.08, 0, 0.12) : 0;
  return { offense, defense, basis: `${round(ppg, 2)} points per game, ${round(toi, 1)} TOI.` };
}

/** Fantasy points per game (common PPR/points scoring). */
export function fantasyPerGame(league: League, row: PlayerRow | null, position: string): number | null {
  if (!row) return null;
  if (league === "nba") return (val(row, "pts") ?? 0) + 1.2 * (val(row, "reb") ?? 0) + 1.5 * (val(row, "ast") ?? 0) + 3 * ((val(row, "stl") ?? 0) + (val(row, "blk") ?? 0)) - (val(row, "tov") ?? 0);
  if (league === "nfl") {
    const g = val(row, "gp") || 1;
    return ((val(row, "passYds") ?? 0) * 0.04 + (val(row, "passTd") ?? 0) * 4 - (val(row, "int") ?? 0) * 2 + ((val(row, "rushYds") ?? 0) + (val(row, "recYds") ?? 0)) * 0.1
      + ((val(row, "rushTd") ?? 0) + (val(row, "recTd") ?? 0)) * 6 + (val(row, "rec") ?? 0)) / g;
  }
  if (league === "mlb") {
    if ((val(row, "pg") ?? 0) > 0 && (val(row, "ab") ?? 0) < 20) {
      const g = val(row, "pg") || 1;
      const ip = val(row, "ip") ?? 0;
      return (ip * 3 + (val(row, "k") ?? 0) - ((val(row, "era") ?? 0) * ip / 9) * 2 + (val(row, "w") ?? 0) * 5) / g;
    }
    const g = val(row, "g") || 1;
    return ((val(row, "h") ?? 0) + (val(row, "r") ?? 0) + (val(row, "rbi") ?? 0) + 2 * (val(row, "hr") ?? 0) + (val(row, "sb") ?? 0) * 2 + (val(row, "bb") ?? 0)) / g;
  }
  if (position.toUpperCase() === "G") {
    const g = val(row, "ggp") || 1;
    return ((val(row, "sv") ?? 0) * 0.2 + (val(row, "gw") ?? 0) * 4 + (val(row, "so") ?? 0) * 3) / g;
  }
  const g = val(row, "gp") || 1;
  return ((val(row, "g") ?? 0) * 3 + (val(row, "a") ?? 0) * 2 + (val(row, "sog") ?? 0) * 0.5 + (val(row, "ppp") ?? 0) * 0.5) / g;
}

const PROP_MARKETS: Record<League, (position: string, row: PlayerRow | null) => string[]> = {
  nba: () => ["Points", "Rebounds", "Assists", "PRA", "3PT made"],
  nfl: (position) => position === "QB" ? ["Passing yards", "Passing TDs", "Completions"] : position === "RB" ? ["Rushing yards", "Rush attempts", "Anytime TD"] : ["WR", "TE"].includes(position) ? ["Receiving yards", "Receptions", "Anytime TD"] : ["Tackles", "Sacks"],
  mlb: (_position, row) => (row && (row.values.pg ?? 0) > 0 && (row.values.ab ?? 0) < 20 ? ["Pitcher strikeouts", "Pitching outs", "Earned runs"] : ["Hits", "Total bases", "Home runs", "RBIs"]),
  nhl: (position) => position === "G" ? ["Saves", "Goals against"] : ["Points", "Shots on goal", "Goals", "Assists"],
};

/** Teammates whose usage typically rises: same position group, ranked by the stat they share. */
export function beneficiaries(league: League, injured: { id: string; position: string }, teammates: PlayerRow[], excluded: Set<string>): Beneficiary[] {
  const pos = injured.position.toUpperCase();
  const pool = teammates.filter((row) => row.id !== injured.id && !excluded.has(row.id));
  let key = "pts";
  let label = "PTS/G";
  let filter: (row: PlayerRow) => boolean = () => true;
  let per = (row: PlayerRow) => val(row, key) ?? 0;
  if (league === "nfl") {
    if (pos === "QB") { key = "passYds"; label = "Pass YDS"; filter = (row) => row.position === "QB"; }
    else if (pos === "RB") { key = "rushYds"; label = "Rush YDS"; filter = (row) => row.position === "RB"; }
    else if (pos === "WR" || pos === "TE") { key = "tgt"; label = "Targets"; filter = (row) => ["WR", "TE"].includes(row.position); }
    else { key = "tackles"; label = "Tackles"; filter = (row) => !["QB", "RB", "WR", "TE"].includes(row.position); }
    per = (row) => perGame(row, key, "gp");
    label = `${label}/G`;
  } else if (league === "mlb") {
    const pitcher = pos === "SP" || pos === "RP" || pos === "P";
    key = pitcher ? "ip" : "ab"; label = pitcher ? "IP" : "AB";
    filter = (row) => (pitcher ? (row.values.pg ?? 0) > 0 : (row.values.ab ?? 0) > 20);
  } else if (league === "nhl") {
    if (pos === "G") { key = "ggp"; label = "GP"; filter = (row) => row.position === "G"; }
    else { key = "pts"; label = "PTS/G"; filter = (row) => row.position !== "G"; per = (row) => perGame(row, "pts", "gp"); }
  }
  return pool.filter(filter).map((row) => ({ id: row.id, name: row.name, position: row.position, stat: label, value: round(per(row), 1) }))
    .sort((a, b) => b.value - a.value).slice(0, 3);
}

function level(value: number, thresholds: [number, number, number, number]): ImpactLevel {
  if (value >= thresholds[0]) return "Very High";
  if (value >= thresholds[1]) return "High";
  if (value >= thresholds[2]) return "Moderate";
  if (value >= thresholds[3]) return "Low";
  return "None";
}

export function tierOf(importance: number): ImpactTier {
  return importance >= 80 ? "Elite" : importance >= 55 ? "High" : importance >= 30 ? "Moderate" : importance >= 12 ? "Low" : "Minimal";
}

export interface ImpactContext {
  league: League;
  status: InjuryStatus;
  position: string;
  row: PlayerRow | null;
  teammates: PlayerRow[];
  /** Fantasy points per game across the league, for percentiles. */
  fantasyPool: number[];
  /** Teammates also out (not counted as beneficiaries). */
  unavailable: Set<string>;
}

export function computeImpact(context: ImpactContext): InjuryImpact {
  const { league, status, position, row } = context;
  const scale = SCALE[league];
  const split = playerValue(league, row, position);
  const loss = split.offense + split.defense;
  const importance = Math.round(100 * clamp(loss / (scale.elite * 1.25), 0, 1));
  const weight = STATUS_WEIGHT[status];
  const fantasy = fantasyPerGame(league, row, position);
  const percentile = fantasy === null || !context.fantasyPool.length ? null : context.fantasyPool.filter((value) => value <= fantasy).length / context.fantasyPool.length;
  const propScore = percentile === null ? importance / 100 : Math.max(percentile, importance / 100);
  const unit = scale.elite;
  return {
    importance,
    tier: tierOf(importance),
    statusWeight: weight,
    projectedImpact: Math.round(importance * weight),
    ratingChange: round(-loss, unit < 1 ? 2 : 1),
    expectedRatingChange: round(-loss * weight, unit < 1 ? 2 : 1),
    ratingUnit: scale.unit,
    winImpact: round(-loss * weight * scale.winPerUnit, 3),
    offensive: { change: round(-split.offense, unit < 1 ? 2 : 1), level: level(split.offense / unit, [0.8, 0.5, 0.25, 0.08]) },
    defensive: { change: round(-split.defense, unit < 1 ? 2 : 1), level: level(split.defense / unit, [0.8, 0.5, 0.25, 0.08]) },
    fantasy: { perGame: fantasy === null ? null : round(fantasy, 1), percentile: percentile === null ? null : round(percentile, 3), level: weight === 0 ? "None" : level(percentile ?? 0, [0.95, 0.8, 0.55, 0.25]) },
    prop: {
      level: weight === 0 ? "None" : level(propScore * Math.max(weight, 0.5), [0.95, 0.85, 0.6, 0.3]),
      markets: PROP_MARKETS[league](position.toUpperCase(), row),
      beneficiaries: weight >= 0.4 ? beneficiaries(league, { id: row?.id ?? "", position }, context.teammates, context.unavailable) : [],
    },
    basis: split.basis,
    hasStats: Boolean(row),
  };
}

export interface TeamHealth {
  teamId: string;
  teamName: string;
  teamAbbr: string;
  logo: string | null;
  score: number;
  label: "Healthy" | "Minor concerns" | "Banged up" | "Depleted";
  active: number;
  out: number;
  questionable: number;
  returning: number;
  suspended: number;
  keyOut: string[];
}

/** 100 = fully healthy. Each unavailable player removes a share proportional to importance × status. */
export function teamHealthScore(entries: Array<{ importance: number; weight: number }>): number {
  const remaining = entries.reduce((health, entry) => health * (1 - 0.5 * (entry.importance / 100) * entry.weight), 1);
  return Math.round(remaining * 100);
}

export const healthLabel = (score: number): TeamHealth["label"] => (score >= 85 ? "Healthy" : score >= 70 ? "Minor concerns" : score >= 50 ? "Banged up" : "Depleted");

/* ---------- Odds impact ---------- */

export interface LineImpact {
  gameId: string;
  game: string;
  commenceTime: string;
  team: string;
  market: "spreads";
  before: { point: number; american: number; at: string } | null;
  current: { point: number; american: number; at: string } | null;
  move: number | null;
  /** "against" = the injured player's team now gets more points (the market downgraded them). */
  direction: "against" | "toward" | "none" | null;
  /** "report": line at the report time. "tracking_start": the report predates line tracking, so the first tracked line is used. */
  baseline: "report" | "tracking_start" | null;
  affectedBooks: Array<{ book: string; name: string; before: number; current: number; delta: number }>;
  message: string;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const fmtPoint = (point: number) => (point > 0 ? `+${point}` : point === 0 ? "PK" : String(point));

/** Matches a sportsbook team name ("Boston Red Sox") to an ESPN nickname ("Red Sox"). */
export function teamNameMatches(oddsName: string, nickname: string, fullName: string): boolean {
  const odds = oddsName.toLowerCase().trim();
  const nick = nickname.toLowerCase().trim();
  return odds === fullName.toLowerCase().trim() || (nick.length > 2 && (odds === nick || odds.endsWith(` ${nick}`)));
}

/**
 * Spread movement on the team's next game since the injury report: each book's last recorded
 * line at or before the report time versus its current line.
 */
export async function lineImpact(league: League, team: { name: string; nickname: string }, reportedAt: string): Promise<LineImpact | null> {
  // The same matchup can exist twice (ESPN and The Odds API IDs); prefer the copy with tracked spreads.
  const games = await pool.query<{ id: string; home_team: string; away_team: string; commence_time: Date; has_spreads: boolean }>(
    `SELECT g.id, g.home_team, g.away_team, g.commence_time,
       EXISTS (SELECT 1 FROM odds_lines l WHERE l.game_id = g.id AND l.market_key = 'spreads') AS has_spreads
     FROM odds_games g
     WHERE g.sport=$1 AND g.commence_time > NOW() - INTERVAL '4 hours' AND g.commence_time < NOW() + INTERVAL '8 days'
     ORDER BY date_trunc('day', g.commence_time), has_spreads DESC, g.commence_time`,
    [league],
  );
  const game = games.rows.find((row) => teamNameMatches(row.home_team, team.nickname, team.name) || teamNameMatches(row.away_team, team.nickname, team.name));
  if (!game) return null;
  const oddsTeam = teamNameMatches(game.home_team, team.nickname, team.name) ? game.home_team : game.away_team;
  const label = `${game.away_team} @ ${game.home_team}`;
  const lines = await pool.query<{ line_id: string; book_key: string; point: string | null; price_american: number; last_seen_at: Date; open_point: string | null; open_american: number; open_at: Date }>(
    `SELECT line_id, book_key, point::text, price_american, last_seen_at, open_point::text, open_american, open_at FROM odds_lines
     WHERE game_id=$1 AND market_key='spreads' AND selection=$2 AND participant=''`,
    [game.id, oddsTeam],
  );
  if (!lines.rows.length) {
    return { gameId: game.id, game: label, commenceTime: game.commence_time.toISOString(), team: oddsTeam, market: "spreads", before: null, current: null, move: null, direction: null, baseline: null, affectedBooks: [], message: "No spread has been recorded for this game yet." };
  }
  const prior = await pool.query<{ book_key: string; point: string | null; price_american: number; observed_at: Date }>(
    `SELECT DISTINCT ON (book_key) book_key, point::text, price_american, observed_at FROM odds_history
     WHERE line_id = ANY($1::text[]) AND observed_at <= $2 ORDER BY book_key, observed_at DESC`,
    [lines.rows.map((row) => row.line_id), reportedAt],
  );
  const priorByBook = new Map(prior.rows.map((row) => [row.book_key, row]));
  const reported = new Date(reportedAt).getTime();
  const names = new Map(getBooks().map((book) => [book.key, book.name]));
  const build = (fromTrackingStart: boolean) => lines.rows.flatMap((row) => {
    if (row.point === null) return [];
    const before = fromTrackingStart ? undefined : priorByBook.get(row.book_key);
    const beforePoint = before?.point ?? (fromTrackingStart || row.open_at.getTime() <= reported ? row.open_point : null);
    if (beforePoint === null || beforePoint === undefined) return [];
    return [{
      book: row.book_key, name: names.get(row.book_key) ?? row.book_key,
      before: { point: Number(beforePoint), american: before?.price_american ?? row.open_american, at: (before?.observed_at ?? row.open_at).toISOString() },
      current: { point: Number(row.point), american: row.price_american, at: row.last_seen_at.toISOString() },
    }];
  });
  let pairs = build(false);
  const baseline: LineImpact["baseline"] = pairs.length ? "report" : "tracking_start";
  if (!pairs.length) pairs = build(true);
  if (!pairs.length) {
    return { gameId: game.id, game: label, commenceTime: game.commence_time.toISOString(), team: oddsTeam, market: "spreads", before: null, current: null, move: null, direction: null, baseline: null, affectedBooks: [], message: "No earlier spread is recorded for this game." };
  }
  const move = round(median(pairs.map((pair) => pair.current.point - pair.before.point)), 1);
  const reference = pairs.find((pair) => pair.book === "draftkings") ?? pairs[0]!;
  const affected = pairs.map((pair) => ({ book: pair.book, name: pair.name, before: pair.before.point, current: pair.current.point, delta: round(pair.current.point - pair.before.point, 1) })).filter((pair) => Math.abs(pair.delta) >= 0.5);
  const direction = Math.abs(move) < 0.5 ? "none" : move > 0 ? "against" : "toward";
  const size = Math.abs(move);
  const since = baseline === "report" ? "since this report" : `since line tracking began (${new Date(reference.before.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}, after this report)`;
  const message = direction === "none"
    ? `No meaningful spread movement ${since} (${oddsTeam} ${fmtPoint(reference.current.point)}).`
    : `The ${oddsTeam} spread has moved ${size} point${size === 1 ? "" : "s"} ${direction === "against" ? "against them" : "in their favor"} ${since} (${fmtPoint(reference.before.point)} → ${fmtPoint(reference.current.point)}).`;
  return {
    gameId: game.id, game: label, commenceTime: game.commence_time.toISOString(), team: oddsTeam, market: "spreads",
    before: { point: reference.before.point, american: reference.before.american, at: reference.before.at },
    current: { point: reference.current.point, american: reference.current.american, at: reference.current.at },
    move, direction, baseline, affectedBooks: affected, message,
  };
}
