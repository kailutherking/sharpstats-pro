import type { ProviderGame } from "../providers/espnStats";
import type { PropStatDef, StatFormat } from "./statsMetrics";

export interface HitRate {
  hits: number;
  games: number;
}

export interface PropMetric {
  key: string;
  label: string;
  short: string;
  format: StatFormat;
  direction: "over" | "under";
  lines: number[];
  line: number | null;
  seasonAvg: number | null;
  last5Avg: number | null;
  last10Avg: number | null;
  median10: number | null;
  stdDev10: number | null;
  high10: number | null;
  low10: number | null;
  homeAvg: number | null;
  awayAvg: number | null;
  homeGames: number;
  awayGames: number;
  hitRate: { last5: HitRate; last10: HitRate; season: HitRate };
  /** Consecutive most-recent games that cleared the default line. */
  streak: number;
  /** Last-5 average versus season average, as a fraction (0.12 = +12%). */
  trend: number | null;
  /** Per-game values, most recent first, aligned with the game log. */
  values: Array<number | null>;
}

export interface Insight {
  id: string;
  tone: "positive" | "negative" | "neutral";
  stat: string;
  headline: string;
  detail: string;
  strength: number;
}

export interface SplitRow {
  label: string;
  games: number;
  averages: Record<string, number | null>;
}

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function standardDeviation(values: number[]) {
  if (values.length < 2) return null;
  const average = mean(values)!;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

export function formatStat(value: number | null, format: StatFormat): string {
  if (value === null || !Number.isFinite(value)) return "—";
  switch (format) {
    case "int": return Number.isInteger(value) ? String(value) : value.toFixed(1);
    case "dec1": return value.toFixed(1);
    case "dec2": return value.toFixed(2);
    case "pct1": return `${value.toFixed(1)}%`;
    case "rate3": return value.toFixed(3).replace(/^0(?=\.)/, "");
    case "signed": return `${value > 0 ? "+" : ""}${Number.isInteger(value) ? value : value.toFixed(1)}`;
    case "minutes": { const whole = Math.floor(value); return `${whole}:${String(Math.round((value - whole) * 60)).padStart(2, "0")}`; }
    case "innings": { const whole = Math.floor(value + 1e-9); return `${whole}.${Math.round((value - whole) * 3)}`; }
    default: return String(value);
  }
}

const clears = (value: number, line: number, direction: "over" | "under") => direction === "over" ? value >= line : value <= line;

export function hitRate(values: Array<number | null>, line: number, direction: "over" | "under"): HitRate {
  const played = values.filter((value): value is number => value !== null);
  return { hits: played.filter((value) => clears(value, line, direction)).length, games: played.length };
}

/** Picks the milestone line closest to the player's recent median, as a market proxy. */
export function defaultLine(lines: number[], recentMedian: number | null): number | null {
  if (!lines.length || recentMedian === null) return null;
  return lines.reduce((best, line) => Math.abs(line - recentMedian) < Math.abs(best - recentMedian) ? line : best, lines[0]!);
}

/** Builds prop research metrics for each prop stat from a game log (most recent game first). */
export function buildPropMetrics(games: ProviderGame[], props: PropStatDef[]): PropMetric[] {
  return props.map((definition) => {
    const values = games.map((game) => definition.value(game.values));
    const played = values.filter((value): value is number => value !== null);
    const last5 = played.slice(0, 5);
    const last10 = played.slice(0, 10);
    const home = games.filter((game, index) => game.home && values[index] !== null).map((game) => definition.value(game.values)!);
    const away = games.filter((game, index) => !game.home && values[index] !== null).map((game) => definition.value(game.values)!);
    const median10 = median(last10);
    const line = defaultLine(definition.lines, median10);
    let streak = 0;
    if (line !== null) for (const value of played) { if (clears(value, line, definition.direction)) streak += 1; else break; }
    const seasonAvg = mean(played);
    const last5Avg = mean(last5);
    return {
      key: definition.key,
      label: definition.label,
      short: definition.short,
      format: definition.format,
      direction: definition.direction,
      lines: definition.lines,
      line,
      seasonAvg,
      last5Avg,
      last10Avg: mean(last10),
      median10,
      stdDev10: standardDeviation(last10),
      high10: last10.length ? Math.max(...last10) : null,
      low10: last10.length ? Math.min(...last10) : null,
      homeAvg: mean(home),
      awayAvg: mean(away),
      homeGames: home.length,
      awayGames: away.length,
      hitRate: {
        last5: line === null ? { hits: 0, games: 0 } : hitRate(last5, line, definition.direction),
        last10: line === null ? { hits: 0, games: 0 } : hitRate(last10, line, definition.direction),
        season: line === null ? { hits: 0, games: 0 } : hitRate(played, line, definition.direction),
      },
      streak,
      trend: seasonAvg && last5Avg !== null && played.length >= 8 && last5.length === 5 ? (last5Avg - seasonAvg) / Math.abs(seasonAvg) : null,
      values,
    };
  }).filter((item) => item.values.some((value) => value !== null));
}

/** Lowercases a label for use mid-sentence while keeping acronyms such as "RBIs". */
function lower(label: string) {
  return label.split(" ").map((word) => (word.match(/[A-Z]/g)?.length ?? 0) > 1 ? word : word.toLowerCase()).join(" ");
}
const lineValue = (metric: PropMetric, line: number) => Number.isInteger(line) ? String(line) : formatStat(line, metric.format);
const averageFormat = (format: StatFormat): StatFormat => format === "int" ? "dec1" : format;

/** "recorded 25+ points" / "allowed 2 or fewer earned runs" */
function lineText(metric: PropMetric, line: number) {
  if (metric.direction === "over") return `recorded ${lineValue(metric, line)}+ ${lower(metric.label)}`;
  return `allowed ${lineValue(metric, line)} or fewer ${lower(metric.label.replace(/ allowed$/i, ""))}`;
}

/**
 * Generates plain-language betting research notes from game logs. Every statement is a
 * description of past results; none is a prediction.
 */
export function generateInsights(name: string, unit: "games" | "starts" | "appearances", metrics: PropMetric[]): Insight[] {
  const insights: Insight[] = [];
  metrics.forEach((metric, order) => {
    const played = metric.values.filter((value): value is number => value !== null);
    const sample = played.slice(0, 10);
    const priority = 1 - order * 0.04;
    if (sample.length >= 5) {
      const needed = Math.ceil(sample.length * 0.7);
      const ordered = metric.direction === "over" ? [...metric.lines].sort((a, b) => b - a) : [...metric.lines].sort((a, b) => a - b);
      // A "0+" over line is always hit, so it never makes a useful note.
      const best = ordered.find((line) => (metric.direction === "under" || line > 0) && hitRate(sample, line, metric.direction).hits >= needed);
      if (best !== undefined) {
        const rate = hitRate(sample, best, metric.direction);
        insights.push({
          id: `${metric.key}-hit-${best}`,
          tone: "positive",
          stat: metric.key,
          headline: `${name} has ${lineText(metric, best)} in ${rate.hits} of last ${rate.games} ${unit}.`,
          detail: `${Math.round(rate.hits / rate.games * 100)}% hit rate. Last-${rate.games} average ${formatStat(metric.last10Avg, averageFormat(metric.format))}, median ${formatStat(metric.median10, averageFormat(metric.format))}.`,
          strength: (rate.hits / rate.games) * priority + 0.1,
        });
      }
      if (metric.line !== null && metric.hitRate.last10.games >= 5 && metric.hitRate.last10.hits / metric.hitRate.last10.games <= 0.3) {
        insights.push({
          id: `${metric.key}-cold-${metric.line}`,
          tone: "negative",
          stat: metric.key,
          headline: `${name} has ${lineText(metric, metric.line)} in only ${metric.hitRate.last10.hits} of last ${metric.hitRate.last10.games} ${unit}.`,
          detail: played.length > 10
            ? `Last-10 average ${formatStat(metric.last10Avg, averageFormat(metric.format))} against a season average of ${formatStat(metric.seasonAvg, averageFormat(metric.format))}.`
            : `Average ${formatStat(metric.last10Avg, averageFormat(metric.format))}, median ${formatStat(metric.median10, averageFormat(metric.format))}.`,
          strength: (1 - metric.hitRate.last10.hits / metric.hitRate.last10.games) * 0.8 * priority,
        });
      }
    }
    if (metric.trend !== null && Math.abs(metric.trend) >= 0.15 && Math.abs((metric.last5Avg ?? 0) - (metric.seasonAvg ?? 0)) >= 0.5) {
      const rising = metric.trend > 0;
      const good = metric.direction === "over" ? rising : !rising;
      insights.push({
        id: `${metric.key}-trend`,
        tone: good ? "positive" : "negative",
        stat: metric.key,
        headline: `${name} is averaging ${formatStat(metric.last5Avg, averageFormat(metric.format))} ${lower(metric.label)} over the last 5 ${unit}.`,
        detail: `${rising ? "Up" : "Down"} ${Math.abs(Math.round(metric.trend * 100))}% from the season average of ${formatStat(metric.seasonAvg, averageFormat(metric.format))}.`,
        strength: Math.min(1, Math.abs(metric.trend)) * 0.9 * priority,
      });
    }
    if (metric.line !== null && metric.streak >= 3) {
      insights.push({
        id: `${metric.key}-streak`,
        tone: "positive",
        stat: metric.key,
        headline: `${name} has ${lineText(metric, metric.line)} in ${metric.streak} straight ${unit}.`,
        detail: `Active streak at the ${lineValue(metric, metric.line)} milestone.`,
        strength: Math.min(1, metric.streak / 8) * 0.85 * priority,
      });
    }
    if (metric.homeGames >= 3 && metric.awayGames >= 3 && metric.homeAvg !== null && metric.awayAvg !== null) {
      const high = Math.max(Math.abs(metric.homeAvg), Math.abs(metric.awayAvg));
      const gap = Math.abs(metric.homeAvg - metric.awayAvg);
      if (metric.homeAvg > 0 && metric.awayAvg > 0 && gap / high >= 0.2 && gap >= 0.5) {
        const better = metric.homeAvg > metric.awayAvg ? "home" : "on the road";
        insights.push({
          id: `${metric.key}-split`,
          tone: "neutral",
          stat: metric.key,
          headline: `${name} averages ${formatStat(metric.homeAvg, averageFormat(metric.format))} ${lower(metric.label)} at home vs ${formatStat(metric.awayAvg, averageFormat(metric.format))} away.`,
          detail: `Production is ${Math.round(gap / high * 100)}% higher ${better} this season.`,
          strength: Math.min(1, gap / high) * 0.6 * priority,
        });
      }
    }
  });
  const perStat = new Map<string, number>();
  return insights
    .sort((a, b) => b.strength - a.strength)
    .filter((insight) => {
      const count = perStat.get(insight.stat) ?? 0;
      perStat.set(insight.stat, count + 1);
      return count < 2;
    })
    .slice(0, 8);
}

/** Home/away and per-opponent averages for each prop stat. */
export function buildSplits(games: ProviderGame[], props: PropStatDef[]): { homeAway: SplitRow[]; opponents: SplitRow[] } {
  const averages = (subset: ProviderGame[]) => Object.fromEntries(props.map((definition) => [
    definition.key,
    mean(subset.map((game) => definition.value(game.values)).filter((value): value is number => value !== null)),
  ]));
  const home = games.filter((game) => game.home);
  const away = games.filter((game) => !game.home);
  const byOpponent = new Map<string, ProviderGame[]>();
  for (const game of games) {
    const key = game.opponentAbbr || game.opponentName;
    if (key) byOpponent.set(key, [...(byOpponent.get(key) ?? []), game]);
  }
  return {
    homeAway: [
      { label: "Home", games: home.length, averages: averages(home) },
      { label: "Away", games: away.length, averages: averages(away) },
    ],
    opponents: [...byOpponent.entries()]
      .map(([label, subset]) => ({ label, games: subset.length, averages: averages(subset) }))
      .sort((a, b) => b.games - a.games || a.label.localeCompare(b.label)),
  };
}

export interface TeamGameLike {
  date: string;
  home: boolean;
  pointsFor: number;
  pointsAgainst: number;
  result: "W" | "L" | "T";
}

export function generateTeamInsights(name: string, pointsLabel: string, games: TeamGameLike[], seasonPointsFor: number | null, seasonPointsAgainst: number | null): Insight[] {
  const insights: Insight[] = [];
  const last10 = games.slice(0, 10);
  if (last10.length >= 5) {
    const wins = last10.filter((game) => game.result === "W").length;
    insights.push({
      id: "team-form",
      tone: wins / last10.length >= 0.6 ? "positive" : wins / last10.length <= 0.4 ? "negative" : "neutral",
      stat: "record",
      headline: `${name} ${wins === 1 ? "has won" : "have won"} ${wins} of their last ${last10.length} games.`,
      detail: `Average margin ${formatStat(mean(last10.map((game) => game.pointsFor - game.pointsAgainst)), "signed")} over that stretch.`,
      strength: Math.abs(wins / last10.length - 0.5) + 0.3,
    });
  }
  let streak = 0;
  const first = games[0]?.result;
  for (const game of games) { if (game.result === first) streak += 1; else break; }
  if (first && first !== "T" && streak >= 3) {
    insights.push({
      id: "team-streak",
      tone: first === "W" ? "positive" : "negative",
      stat: "record",
      headline: `${name} ${first === "W" ? "have won" : "have lost"} ${streak} straight.`,
      detail: `Most recent: ${games[0]!.pointsFor}-${games[0]!.pointsAgainst} ${games[0]!.home ? "at home" : "on the road"}.`,
      strength: Math.min(1, streak / 8) + 0.2,
    });
  }
  const last5 = games.slice(0, 5);
  if (last5.length === 5 && games.length >= 8) {
    const recentFor = mean(last5.map((game) => game.pointsFor))!;
    const recentAgainst = mean(last5.map((game) => game.pointsAgainst))!;
    if (seasonPointsFor && Math.abs(recentFor - seasonPointsFor) / seasonPointsFor >= 0.08) {
      insights.push({
        id: "team-offense-trend",
        tone: recentFor > seasonPointsFor ? "positive" : "negative",
        stat: "pointsFor",
        headline: `${name} are scoring ${recentFor.toFixed(1)} ${pointsLabel.toLowerCase()} per game over the last 5.`,
        detail: `Season average: ${seasonPointsFor.toFixed(1)}.`,
        strength: Math.abs(recentFor - seasonPointsFor) / seasonPointsFor + 0.2,
      });
    }
    if (seasonPointsAgainst && Math.abs(recentAgainst - seasonPointsAgainst) / seasonPointsAgainst >= 0.08) {
      insights.push({
        id: "team-defense-trend",
        tone: recentAgainst < seasonPointsAgainst ? "positive" : "negative",
        stat: "pointsAgainst",
        headline: `${name} are allowing ${recentAgainst.toFixed(1)} ${pointsLabel.toLowerCase()} per game over the last 5.`,
        detail: `Season average allowed: ${seasonPointsAgainst.toFixed(1)}.`,
        strength: Math.abs(recentAgainst - seasonPointsAgainst) / seasonPointsAgainst + 0.2,
      });
    }
    const totals = last10.map((game) => game.pointsFor + game.pointsAgainst);
    insights.push({
      id: "team-totals",
      tone: "neutral",
      stat: "total",
      headline: `${name} games have averaged ${mean(totals)!.toFixed(1)} combined ${pointsLabel.toLowerCase()} over the last ${totals.length}.`,
      detail: `Range ${Math.min(...totals)}–${Math.max(...totals)}; median ${median(totals)!.toFixed(1)}.`,
      strength: 0.25,
    });
  }
  const home = games.filter((game) => game.home);
  const away = games.filter((game) => !game.home);
  if (home.length >= 3 && away.length >= 3) {
    const homeRate = home.filter((game) => game.result === "W").length / home.length;
    const awayRate = away.filter((game) => game.result === "W").length / away.length;
    if (Math.abs(homeRate - awayRate) >= 0.25) {
      insights.push({
        id: "team-home-away",
        tone: "neutral",
        stat: "record",
        headline: `${name} win ${Math.round(homeRate * 100)}% at home and ${Math.round(awayRate * 100)}% on the road.`,
        detail: `Based on ${home.length} home and ${away.length} road games this season.`,
        strength: Math.abs(homeRate - awayRate) * 0.8,
      });
    }
  }
  return insights.sort((a, b) => b.strength - a.strength).slice(0, 6);
}
