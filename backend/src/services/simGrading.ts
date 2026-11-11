/**
 * Grading rules for simulated wagers. Pure functions: the service layer supplies final scores and
 * box-score values, these decide win / loss / push / void the way a regulated US sportsbook would.
 */

export type LegStatus = "open" | "won" | "lost" | "push" | "void";
export type WagerStatus = "open" | "won" | "lost" | "push" | "void";

export interface GradableLeg {
  sport: string;
  marketKey: string;
  marketType: string;
  period: string;
  selection: string;
  participant: string;
  point: number | null;
  homeTeam: string;
  awayTeam: string;
}

export interface FinalScore {
  home: number;
  away: number;
  /** Points per period (quarters, halves, periods or innings), overtime periods included at the end. */
  homeLines: Array<number | null>;
  awayLines: Array<number | null>;
}

export interface LegGrade { status: Exclude<LegStatus, "open">; value: number | null; note: string }

export const normalizeName = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
/** Player names differ in suffixes between books and box scores ("Jr.", "III"). */
export const normalizePlayer = (value: string) => normalizeName(value.replace(/\b(jr|sr|ii|iii|iv|v)\.?$/i, ""));

const TEAM_NOISE = new Set(["university", "univ", "the", "of"]);
/**
 * Team-name tokens with the abbreviations books and score providers disagree on made uniform:
 * "Florida St Seminoles" and "Florida State Seminoles" both become florida/state/seminoles,
 * while a leading "St." stays a saint ("St. John's", "Saint Mary's").
 */
export function teamTokens(name: string): string[] {
  const words = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\(.*?\)/g, " ").replace(/&/g, " and ").replace(/['’.]/g, "")
    .split(/[^a-z0-9]+/).filter(Boolean);
  return words.map((word, index) => word === "saint" ? "st" : word === "st" && index > 0 ? "state" : word).filter((word) => !TEAM_NOISE.has(word));
}
export const canonicalTeam = (name: string) => teamTokens(name).join("");

/** 1 for the same team, otherwise the share of name tokens two spellings have in common. */
export function teamSimilarity(a: string, b: string): number {
  const left = teamTokens(a);
  const right = teamTokens(b);
  if (!left.length || !right.length) return 0;
  if (left.join("") === right.join("")) return 1;
  const shared = left.filter((token) => right.includes(token)).length;
  return shared / new Set([...left, ...right]).size;
}

const sum = (values: Array<number | null>): number | null => values.length && values.every((value) => typeof value === "number") ? (values as number[]).reduce((a, b) => a + b, 0) : null;

/** Score for the part of the game a market covers. Null when the provider did not publish period scores. */
export function periodScore(sport: string, period: string, score: FinalScore): { home: number; away: number } | null {
  if (period === "game") return { home: score.home, away: score.away };
  const slice = (from: number, to?: number) => {
    if (score.homeLines.length <= from) return null;
    const home = sum(score.homeLines.slice(from, to));
    const away = sum(score.awayLines.slice(from, to));
    return home === null || away === null ? null : { home, away };
  };
  const halves = sport === "ncaab";
  switch (period) {
    case "1h": return halves ? slice(0, 1) : score.homeLines.length >= 2 ? slice(0, 2) : null;
    // Second-half markets include overtime at US books.
    case "2h": return halves ? slice(1) : slice(2);
    case "1q":
    case "1p": return slice(0, 1);
    case "f5": return score.homeLines.length >= 5 ? slice(0, 5) : null;
    default: return null;
  }
}

function sideOf(leg: GradableLeg, name: string): "home" | "away" | null {
  const wanted = canonicalTeam(name);
  if (!wanted) return null;
  if (wanted === canonicalTeam(leg.homeTeam)) return "home";
  if (wanted === canonicalTeam(leg.awayTeam)) return "away";
  return null;
}

/** Moneyline, spread, total and team-total legs. Returns null when the score needed is not available. */
export function gradeGameLeg(leg: GradableLeg, score: FinalScore): LegGrade | null {
  const scope = periodScore(leg.sport, leg.period, score);
  if (!scope) return null;
  const text = `${scope.away}-${scope.home}`;
  if (leg.marketType === "moneyline") {
    const side = sideOf(leg, leg.selection);
    if (!side) return /^(draw|tie)$/i.test(leg.selection) ? { status: scope.home === scope.away ? "won" : "lost", value: null, note: text } : null;
    const mine = scope[side];
    const theirs = scope[side === "home" ? "away" : "home"];
    return { status: mine === theirs ? "push" : mine > theirs ? "won" : "lost", value: mine - theirs, note: text };
  }
  if (leg.marketType === "spread") {
    const side = sideOf(leg, leg.selection);
    if (!side || leg.point === null) return null;
    const margin = scope[side] - scope[side === "home" ? "away" : "home"] + leg.point;
    return { status: margin === 0 ? "push" : margin > 0 ? "won" : "lost", value: margin - leg.point, note: text };
  }
  if (leg.marketType === "total" || leg.marketType === "team_total") {
    if (leg.point === null) return null;
    const over = /^over/i.test(leg.selection);
    if (!over && !/^under/i.test(leg.selection)) return null;
    let total = scope.home + scope.away;
    if (leg.marketType === "team_total") {
      const side = sideOf(leg, leg.participant);
      if (!side) return null;
      total = scope[side];
    }
    return { status: total === leg.point ? "push" : (total > leg.point) === over ? "won" : "lost", value: total, note: text };
  }
  return null;
}

type Box = Record<string, number | null>;
const pick = (key: string) => (box: Box) => box[key] ?? null;
const add = (...keys: string[]) => (box: Box) => {
  const parts = keys.map((key) => box[key]);
  return parts.some((part) => part === null || part === undefined) ? null : (parts as number[]).reduce((a, b) => a + b, 0);
};
const doubles = (box: Box) => ["points", "rebounds", "assists", "steals", "blocks"].filter((key) => (box[key] ?? 0) >= 10).length;

/** Box-score stat behind each basketball player-prop market (NBA and NCAA share box-score keys). */
export const BASKETBALL_PROP_STATS: Record<string, (box: Box) => number | null> = {
  player_points: pick("points"),
  player_rebounds: pick("rebounds"),
  player_assists: pick("assists"),
  player_threes: pick("threePointFieldGoalsMade"),
  player_steals: pick("steals"),
  player_blocks: pick("blocks"),
  player_turnovers: pick("turnovers"),
  player_minutes: pick("minutes"),
  player_points_rebounds: add("points", "rebounds"),
  player_points_assists: add("points", "assists"),
  player_rebounds_assists: add("rebounds", "assists"),
  player_points_rebounds_assists: add("points", "rebounds", "assists"),
  player_double_double: (box) => box.points === undefined ? null : doubles(box) >= 2 ? 1 : 0,
  player_triple_double: (box) => box.points === undefined ? null : doubles(box) >= 3 ? 1 : 0,
};

/** A prop is void when the player does not take part; otherwise Over/Under (or Yes/No) against the stat. */
export function gradePropLeg(leg: Pick<GradableLeg, "marketType" | "selection" | "point">, value: number | null, played: boolean): LegGrade | null {
  if (!played) return { status: "void", value: null, note: "Player did not play" };
  if (value === null) return null;
  if (leg.marketType === "prop_yes") {
    const yes = !/^no$/i.test(leg.selection);
    return { status: (value >= 1) === yes ? "won" : "lost", value, note: String(value) };
  }
  if (leg.point === null) return null;
  const over = /^over/i.test(leg.selection);
  if (!over && !/^under/i.test(leg.selection)) return null;
  return { status: value === leg.point ? "push" : (value > leg.point) === over ? "won" : "lost", value, note: String(value) };
}

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function toAmerican(decimal: number): number {
  if (!(decimal > 1)) return 0;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

/** Parlay price: the product of its legs' decimal odds. */
export function combineDecimal(decimals: number[]): number {
  return decimals.reduce((total, decimal) => total * decimal, 1);
}

export interface Settlement { status: Exclude<WagerStatus, "open">; decimal: number; payout: number; profitLoss: number }

/**
 * Settles a single or parlay from its legs. One losing leg loses the wager. Pushed and voided legs
 * drop out and the parlay pays at the reduced odds; if nothing is left the stake is refunded.
 * Returns null while a leg is still open and no leg has lost.
 */
export function settleWager(stake: number, legs: Array<{ status: LegStatus; decimal: number }>): Settlement | null {
  if (legs.some((leg) => leg.status === "lost")) return { status: "lost", decimal: combineDecimal(legs.map((leg) => leg.decimal)), payout: 0, profitLoss: -stake };
  if (legs.some((leg) => leg.status === "open")) return null;
  const won = legs.filter((leg) => leg.status === "won");
  if (!won.length) return { status: legs.some((leg) => leg.status === "push") ? "push" : "void", decimal: 1, payout: round2(stake), profitLoss: 0 };
  const decimal = combineDecimal(won.map((leg) => leg.decimal));
  const payout = round2(stake * decimal);
  return { status: "won", decimal, payout, profitLoss: round2(payout - stake) };
}

/** Closing line value: how much better the price taken was than the closing price (positive beats the close). */
export function clvPct(placedDecimal: number, closingDecimal: number | null): number | null {
  return closingDecimal && closingDecimal > 1 ? (placedDecimal / closingDecimal - 1) * 100 : null;
}

/** Expected value per dollar staked, as a percentage, from a fair (no-vig) win probability. */
export function evPct(fairProbability: number | null, decimal: number): number | null {
  return fairProbability === null ? null : (fairProbability * decimal - 1) * 100;
}
