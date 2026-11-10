/**
 * Live game adapters.
 *
 * ESPN's public scoreboard and game summary feeds supply scores, clocks, situations (possession,
 * down and distance, balls/strikes/outs, base runners), box scores, leaders, win probability and
 * DraftKings opening/closing lines for the NBA, NFL, MLB and NHL. The NHL's official API
 * (api-web.nhle.com) supplies power-play strength, which ESPN does not publish. Neither needs a key.
 */
import { toNumber, StatsProviderError, type League } from "./espnStats";

const SITE_API = (process.env.ESPN_SITE_API_URL ?? "https://site.api.espn.com").replace(/\/+$/, "");
const NHL_API = (process.env.NHL_API_URL ?? "https://api-web.nhle.com").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.LIVE_PROVIDER_TIMEOUT_MS ?? 12000);
const PATHS: Record<League, string> = { nba: "basketball/nba", nfl: "football/nfl", mlb: "baseball/mlb", nhl: "hockey/nhl" };

async function fetchJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "SharpStatsPro/1.5 (+live research)" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new StatsProviderError(`Live provider unreachable: ${error instanceof Error ? error.message : "network error"}`);
  }
  if (!response.ok) throw new StatsProviderError(`Live provider request failed (${response.status})`, response.status);
  return response.json() as Promise<T>;
}

/* ---------- Types ---------- */

export type LiveStatus = "pregame" | "live" | "halftime" | "end_period" | "final" | "delayed" | "postponed";

export interface LiveTeam {
  id: string;
  name: string;
  shortName: string;
  abbr: string;
  logo: string | null;
  score: number | null;
  record: string | null;
  linescores: Array<number | null>;
  winner: boolean;
  timeouts: number | null;
  /** Team fouls in the current period (NBA). */
  fouls: number | null;
  inBonus: boolean | null;
  shots: number | null;
}

export interface SituationPlayer { id: string; name: string; summary: string | null; headshot: string | null }

export interface LiveSituation {
  possessionTeamId: string | null;
  lastPlay: string | null;
  // Football
  down: number | null;
  distance: number | null;
  yardLine: number | null;
  downDistance: string | null;
  possessionText: string | null;
  isRedZone: boolean;
  // Baseball
  balls: number | null;
  strikes: number | null;
  outs: number | null;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  pitcher: SituationPlayer | null;
  batter: SituationPlayer | null;
  // Hockey
  powerPlay: { teamId: string; strength: string; timeRemaining: string | null } | null;
  penalties: string[];
}

export interface DkLine {
  provider: string;
  spread: { home: { line: number | null; odds: number | null }; away: { line: number | null; odds: number | null } } | null;
  total: { line: number | null; over: number | null; under: number | null } | null;
  moneyline: { home: number | null; away: number | null } | null;
}

export interface ProviderLiveGame {
  id: string;
  league: League;
  name: string;
  shortName: string;
  startTime: string;
  status: LiveStatus;
  statusDetail: string;
  clock: string | null;
  period: number;
  periodLabel: string | null;
  home: LiveTeam;
  away: LiveTeam;
  situation: LiveSituation;
  venue: string | null;
  broadcast: string | null;
  /** Home win probability 0–1 from ESPN's model, when published. */
  homeWinProbability: number | null;
  espnOdds: { current: DkLine | null; open: DkLine | null };
}

/* ---------- Parsing helpers ---------- */

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" ? value as Json : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null);
const num = (value: unknown): number | null => toNumber(value);

export function americanOf(value: unknown): number | null {
  const text = str(value);
  if (!text) return null;
  if (/^even$/i.test(text)) return 100;
  const parsed = Number(text.replace(/^[ou]/i, "").replace(/^\+/, ""));
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

export function lineOf(value: unknown): number | null {
  const text = str(value);
  if (!text) return null;
  if (/^pk$/i.test(text)) return 0;
  const parsed = Number(text.replace(/^[ou]/i, "").replace(/^\+/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function statusOf(type: Json): LiveStatus {
  const name = str(type.name) ?? "";
  const state = str(type.state) ?? "";
  if (name === "STATUS_HALFTIME") return "halftime";
  if (name === "STATUS_END_PERIOD") return "end_period";
  if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED|FORFEIT/.test(name)) return "postponed";
  if (/DELAY/.test(name)) return "delayed";
  if (state === "pre") return "pregame";
  if (state === "post" || type.completed === true) return "final";
  if (state === "in") return "live";
  return "pregame";
}

/** Live means the game is underway, including breaks between periods. */
export const isInProgress = (status: LiveStatus) => status === "live" || status === "halftime" || status === "end_period" || status === "delayed";

function ordinal(value: number): string {
  const suffix = value % 100 >= 11 && value % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][value % 10] ?? "th";
  return `${value}${suffix}`;
}

export function periodLabel(league: League, period: number, detail: string): string | null {
  if (period <= 0) return null;
  if (league === "mlb") {
    const half = /^(top|bot|bottom|mid|middle|end)/i.exec(detail)?.[1]?.toLowerCase();
    const prefix = half === "top" ? "Top" : half === "bot" || half === "bottom" ? "Bot" : half === "mid" || half === "middle" ? "Mid" : half === "end" ? "End" : "";
    return `${prefix ? `${prefix} ` : ""}${ordinal(period)}`;
  }
  const regulation = league === "nhl" ? 3 : 4;
  if (period <= regulation) return league === "nhl" ? `P${period}` : `Q${period}`;
  if (league === "nhl" && /shootout/i.test(detail)) return "SO";
  return period === regulation + 1 ? "OT" : `${period - regulation}OT`;
}

function situationPlayer(value: unknown): SituationPlayer | null {
  const node = obj(value);
  const athlete = obj(node.athlete);
  const id = str(athlete.id) ?? str(node.playerId);
  if (!id) return null;
  return { id, name: str(athlete.displayName) ?? str(athlete.fullName) ?? "", summary: str(node.summary), headshot: str(athlete.headshot) ?? str(obj(athlete.headshot).href) };
}

function emptySituation(): LiveSituation {
  return {
    possessionTeamId: null, lastPlay: null, down: null, distance: null, yardLine: null, downDistance: null, possessionText: null, isRedZone: false,
    balls: null, strikes: null, outs: null, onFirst: false, onSecond: false, onThird: false, pitcher: null, batter: null, powerPlay: null, penalties: [],
  };
}

/** Merges a scoreboard or summary `situation` node (fields differ by sport; missing ones stay null). */
export function parseSituation(raw: unknown, base = emptySituation()): LiveSituation {
  const node = obj(raw);
  if (!Object.keys(node).length) return base;
  const lastPlay = obj(node.lastPlay);
  const down = num(node.down);
  return {
    ...base,
    possessionTeamId: str(node.possession) ?? base.possessionTeamId,
    lastPlay: str(lastPlay.text) ?? base.lastPlay,
    down: down !== null && down > 0 ? down : base.down,
    distance: num(node.distance) ?? base.distance,
    yardLine: num(node.yardLine) ?? base.yardLine,
    downDistance: str(node.downDistanceText) ?? str(node.shortDownDistanceText) ?? base.downDistance,
    possessionText: str(node.possessionText) ?? base.possessionText,
    isRedZone: node.isRedZone === true || base.isRedZone,
    balls: num(node.balls) ?? base.balls,
    strikes: num(node.strikes) ?? base.strikes,
    outs: num(node.outs) ?? base.outs,
    onFirst: node.onFirst === true || (node.onFirst === undefined && base.onFirst),
    onSecond: node.onSecond === true || (node.onSecond === undefined && base.onSecond),
    onThird: node.onThird === true || (node.onThird === undefined && base.onThird),
    pitcher: situationPlayer(node.pitcher) ?? base.pitcher,
    batter: situationPlayer(node.batter) ?? base.batter,
  };
}

function teamOf(competitor: Json): LiveTeam {
  const team = obj(competitor.team);
  const records = arr(competitor.records ?? competitor.record).map(obj);
  const total = records.find((record) => str(record.type) === "total" || str(record.name) === "overall") ?? records[0];
  const logo = str(team.logo) ?? str(obj(arr(team.logos)[0]).href);
  return {
    id: str(team.id) ?? str(competitor.id) ?? "",
    name: str(team.displayName) ?? str(team.name) ?? "",
    shortName: str(team.shortDisplayName) ?? str(team.name) ?? "",
    abbr: str(team.abbreviation) ?? "",
    logo,
    score: null,
    record: total ? str(total.summary) ?? str(total.displayValue) : null,
    linescores: arr(competitor.linescores).map((line) => num(obj(line).value ?? obj(line).displayValue)),
    winner: competitor.winner === true,
    // Live summaries carry timeouts and team fouls on each competitor (NBA).
    timeouts: num(competitor.timeoutsRemaining),
    fouls: num(obj(competitor.fouls).teamFoulsCurrent ?? obj(competitor.fouls).teamFouls),
    inBonus: str(obj(competitor.fouls).bonusState) ? !/none/i.test(str(obj(competitor.fouls).bonusState)!) : null,
    shots: null,
  };
}

/** DraftKings lines on the scoreboard (`odds`) or summary (`pickcenter`) node. */
export function parseEspnOdds(raw: unknown): { current: DkLine | null; open: DkLine | null } {
  const node = obj(raw);
  if (!Object.keys(node).length) return { current: null, open: null };
  const provider = str(obj(node.provider).name) ?? "DraftKings";
  const ml = obj(node.moneyline);
  const ps = obj(node.pointSpread);
  const tot = obj(node.total);
  const pick = (side: unknown, key: "close" | "open") => obj(obj(side)[key]);
  const build = (key: "close" | "open"): DkLine | null => {
    const spread = { home: { line: lineOf(pick(ps.home, key).line), odds: americanOf(pick(ps.home, key).odds) }, away: { line: lineOf(pick(ps.away, key).line), odds: americanOf(pick(ps.away, key).odds) } };
    const total = { line: lineOf(pick(tot.over, key).line), over: americanOf(pick(tot.over, key).odds), under: americanOf(pick(tot.under, key).odds) };
    const moneyline = { home: americanOf(pick(ml.home, key).odds), away: americanOf(pick(ml.away, key).odds) };
    const has = spread.home.line !== null || total.line !== null || moneyline.home !== null;
    return has ? { provider, spread: spread.home.line === null ? null : spread, total: total.line === null ? null : total, moneyline: moneyline.home === null && moneyline.away === null ? null : moneyline } : null;
  };
  let current = build("close");
  if (!current) {
    // Older payload shape: flat current numbers.
    const homeOdds = obj(node.homeTeamOdds);
    const awayOdds = obj(node.awayTeamOdds);
    const spread = num(node.spread);
    const homeFav = homeOdds.favorite === true;
    const overUnder = num(node.overUnder);
    const moneyHome = num(homeOdds.moneyLine);
    if (spread !== null || overUnder !== null || moneyHome !== null) {
      current = {
        provider,
        spread: spread === null ? null : { home: { line: homeFav ? -Math.abs(spread) : Math.abs(spread), odds: num(homeOdds.spreadOdds) }, away: { line: homeFav ? Math.abs(spread) : -Math.abs(spread), odds: num(awayOdds.spreadOdds) } },
        total: overUnder === null ? null : { line: overUnder, over: num(node.overOdds), under: num(node.underOdds) },
        moneyline: moneyHome === null ? null : { home: moneyHome, away: num(awayOdds.moneyLine) },
      };
    }
  }
  return { current, open: build("open") };
}

/** Normalizes one scoreboard event (also used with a summary's `header`). */
export function normalizeEvent(league: League, event: Json): ProviderLiveGame | null {
  const competition = obj(arr(event.competitions)[0]);
  const competitors = arr(competition.competitors).map(obj);
  const homeRaw = competitors.find((item) => item.homeAway === "home");
  const awayRaw = competitors.find((item) => item.homeAway === "away");
  if (!homeRaw || !awayRaw) return null;
  const statusNode = obj(competition.status ?? event.status);
  const type = obj(statusNode.type);
  const status = statusOf(type);
  const detail = str(type.shortDetail) ?? str(type.detail) ?? str(type.description) ?? "";
  const period = num(statusNode.period) ?? 0;
  const home = teamOf(homeRaw);
  const away = teamOf(awayRaw);
  if (status !== "pregame") {
    home.score = num(homeRaw.score);
    away.score = num(awayRaw.score);
  }
  const situation = parseSituation(competition.situation);
  if (!situation.possessionTeamId) {
    const holder = competitors.find((item) => item.possession === true);
    if (holder) situation.possessionTeamId = str(obj(holder.team).id) ?? str(holder.id);
  }
  const probability = obj(obj(obj(competition.situation).lastPlay).probability);
  const oddsNode = arr(competition.odds)[0];
  const venue = obj(competition.venue);
  const broadcast = arr(competition.broadcasts).map(obj).flatMap((item) => arr(item.names).map((name) => str(name)).concat(str(obj(item.media).shortName))).find(Boolean) ?? null;
  const clock = str(statusNode.displayClock);
  return {
    id: str(event.id) ?? str(competition.id) ?? "",
    league,
    name: str(event.name) ?? `${away.name} at ${home.name}`,
    shortName: str(event.shortName) ?? `${away.abbr} @ ${home.abbr}`,
    startTime: str(competition.date) ?? str(event.date) ?? new Date().toISOString(),
    status,
    statusDetail: detail,
    clock: isInProgress(status) && league !== "mlb" ? clock : null,
    period,
    periodLabel: status === "pregame" ? null : periodLabel(league, period, detail),
    home,
    away,
    situation,
    venue: str(venue.fullName),
    broadcast,
    homeWinProbability: num(probability.homeWinPercentage),
    espnOdds: parseEspnOdds(oddsNode),
  };
}

/* ---------- Scoreboard ---------- */

function easternDate(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date).replace(/-/g, "");
}

/** Today's slate (US Eastern), plus games from yesterday that are still in progress past midnight. */
export async function fetchLiveScoreboard(league: League): Promise<ProviderLiveGame[]> {
  // NFL's default scoreboard is the current week; the other leagues use today's date (US Eastern).
  const [today, yesterday] = await Promise.all([
    fetchJson<{ events?: Json[] }>(`${SITE_API}/apis/site/v2/sports/${PATHS[league]}/scoreboard${league === "nfl" ? "" : `?dates=${easternDate(0)}`}`),
    fetchJson<{ events?: Json[] }>(`${SITE_API}/apis/site/v2/sports/${PATHS[league]}/scoreboard?dates=${easternDate(-1)}`).catch(() => ({ events: [] as Json[] })),
  ]);
  const games = new Map<string, ProviderLiveGame>();
  for (const event of arr(yesterday.events).map(obj)) {
    const game = normalizeEvent(league, event);
    if (game && isInProgress(game.status)) games.set(game.id, game);
  }
  for (const event of arr(today.events).map(obj)) {
    const game = normalizeEvent(league, event);
    if (game) games.set(game.id, game);
  }
  return [...games.values()];
}

/* ---------- Game summary ---------- */

export interface BoxPlayer {
  id: string;
  name: string;
  shortName: string;
  position: string;
  headshot: string | null;
  starter: boolean;
  active: boolean;
  didNotPlay: boolean;
  /** Display strings by label, e.g. { PTS: "22", FG: "8-16" }. */
  display: Record<string, string>;
  /** Numbers by provider key; combined keys ("made-attempted") are split. */
  values: Record<string, number | null>;
}

export interface BoxGroup { key: string; label: string; labels: string[]; keys: string[]; players: BoxPlayer[]; totals: string[] }
export interface BoxTeam { teamId: string; groups: BoxGroup[] }
export interface TeamStatLine { key: string; label: string; home: string; away: string }
export interface LeaderLine { category: string; label: string; teamId: string; playerId: string; name: string; headshot: string | null; value: string }
export interface PlayText { id: string; text: string; clock: string | null; period: number | null; scoring: boolean; teamId: string | null; type: string | null }

export interface ProviderGameDetail {
  game: ProviderLiveGame;
  teamStats: TeamStatLine[];
  box: BoxTeam[];
  leaders: LeaderLine[];
  plays: PlayText[];
  winProbability: Array<{ home: number; playId: string }>;
  pickcenter: { current: DkLine | null; open: DkLine | null };
}

const GROUP_LABELS: Record<string, string> = {
  passing: "Passing", rushing: "Rushing", receiving: "Receiving", fumbles: "Fumbles", defensive: "Defense", interceptions: "Interceptions",
  kickReturns: "Kick returns", puntReturns: "Punt returns", kicking: "Kicking", punting: "Punting",
  forwards: "Forwards", defenses: "Defense", skaters: "Skaters", goalies: "Goalies", batting: "Batting", pitching: "Pitching", players: "Players",
};

/** Splits "8-16" into made/attempted, "16/26" into completions/attempts and "5.2" innings into outs-aware decimals. */
export function boxValues(keys: string[], stats: string[]): Record<string, number | null> {
  const values: Record<string, number | null> = {};
  keys.forEach((key, index) => {
    const raw = stats[index] ?? "";
    const parts = key.split(/[-/]/);
    if (parts.length === 2 && /[-/]/.test(raw.replace(/^-/, ""))) {
      const [a, b] = raw.split(/[-/]/);
      values[parts[0]!] = num(a);
      values[parts[1]!] = num(b);
      return;
    }
    if (key === "fullInnings.partInnings") {
      const innings = num(raw);
      values.innings = innings === null ? null : Math.trunc(innings) + Math.round((innings - Math.trunc(innings)) * 10) / 3;
      values.outsRecorded = innings === null ? null : Math.trunc(innings) * 3 + Math.round((innings - Math.trunc(innings)) * 10);
      return;
    }
    values[key] = num(raw);
  });
  return values;
}

function parseBox(league: League, raw: unknown): BoxTeam[] {
  return arr(obj(raw).players).map(obj).map((team) => {
    const teamId = str(obj(team.team).id) ?? "";
    const groups = arr(team.statistics).map(obj).map((group, index): BoxGroup => {
      const keys = arr(group.keys).map((key) => str(key) ?? "");
      const name = str(group.name) ?? (league === "mlb" ? (keys.includes("fullInnings.partInnings") ? "pitching" : "batting") : league === "nba" ? "players" : `group${index}`);
      const labels = arr(group.labels).map((label) => str(label) ?? "");
      const players = arr(group.athletes).map(obj).map((row): BoxPlayer | null => {
        const athlete = obj(row.athlete);
        const id = str(athlete.id);
        if (!id) return null;
        const stats = arr(row.stats).map((value) => str(value) ?? "");
        const position = obj(athlete.position);
        return {
          id,
          name: str(athlete.displayName) ?? "",
          shortName: str(athlete.shortName) ?? str(athlete.displayName) ?? "",
          position: str(position.abbreviation) ?? str(obj(row.position).abbreviation) ?? "",
          headshot: str(obj(athlete.headshot).href),
          starter: row.starter === true,
          active: row.active !== false,
          didNotPlay: row.didNotPlay === true || stats.length === 0,
          display: Object.fromEntries(labels.map((label, i) => [label, stats[i] ?? ""])),
          values: boxValues(keys, stats),
        };
      }).filter((player): player is BoxPlayer => Boolean(player));
      return { key: name, label: GROUP_LABELS[name] ?? name, labels, keys, players, totals: arr(group.totals).map((value) => str(value) ?? "") };
    }).filter((group) => group.players.length);
    return { teamId, groups };
  });
}

const TEAM_STAT_LABELS: Record<string, string> = {
  fieldGoalsMade_fieldGoalsAttempted: "Field goals", fieldGoalPct: "FG%", threePointFieldGoalsMade_threePointFieldGoalsAttempted: "3-pointers", threePointFieldGoalPct: "3P%",
  freeThrowsMade_freeThrowsAttempted: "Free throws", freeThrowPct: "FT%", totalRebounds: "Rebounds", offensiveRebounds: "Offensive rebounds", assists: "Assists",
  steals: "Steals", blocks: "Blocks", totalTurnovers: "Turnovers", fouls: "Fouls", pointsInPaint: "Points in paint", fastBreakPoints: "Fast-break points", largestLead: "Largest lead",
  firstDowns: "First downs", thirdDownEff: "3rd-down efficiency", fourthDownEff: "4th-down efficiency", totalYards: "Total yards", netPassingYards: "Passing yards",
  rushingYards: "Rushing yards", yardsPerPlay: "Yards per play", turnovers: "Turnovers", totalPenaltiesYards: "Penalties", possessionTime: "Possession", redZoneAttempts: "Red zone",
  shotsTotal: "Shots on goal", powerPlayGoals: "Power-play goals", powerPlayOpportunities: "Power plays", faceoffPercent: "Faceoff %", hits: "Hits", blockedShots: "Blocked shots",
  penaltyMinutes: "Penalty minutes", giveaways: "Giveaways", takeaways: "Takeaways",
};

function parseTeamStats(raw: unknown, homeId: string): TeamStatLine[] {
  const teams = arr(obj(raw).teams).map(obj);
  const home = teams.find((team) => str(obj(team.team).id) === homeId) ?? teams[1];
  const away = teams.find((team) => team !== home) ?? teams[0];
  if (!home || !away) return [];
  const flatten = (team: Json) => {
    const map = new Map<string, string>();
    for (const stat of arr(team.statistics).map(obj)) {
      const nested = arr(stat.stats);
      if (nested.length) {
        // MLB nests batting/pitching groups.
        for (const inner of nested.map(obj)) map.set(`${str(stat.name)}.${str(inner.name)}`, str(inner.displayValue) ?? "");
      } else {
        map.set((str(stat.name) ?? "").replace(/-/g, "_"), str(stat.displayValue) ?? "");
      }
    }
    return map;
  };
  const h = flatten(home);
  const a = flatten(away);
  const mlb: Record<string, string> = { "batting.hits": "Hits", "batting.homeRuns": "Home runs", "batting.walks": "Walks", "batting.strikeouts": "Strikeouts (batting)", "batting.avg": "Batting avg", "pitching.pitches": "Pitches", "fielding.errors": "Errors" };
  const labels = { ...TEAM_STAT_LABELS, ...mlb };
  return Object.entries(labels).filter(([key]) => h.has(key) || a.has(key)).map(([key, label]) => ({ key, label, home: h.get(key) ?? "—", away: a.get(key) ?? "—" }));
}

function parseLeaders(raw: unknown): LeaderLine[] {
  return arr(raw).map(obj).flatMap((team) => {
    const teamId = str(obj(team.team).id) ?? "";
    return arr(team.leaders).map(obj).flatMap((category) => {
      const top = obj(arr(category.leaders)[0]);
      const athlete = obj(top.athlete);
      const playerId = str(athlete.id);
      if (!playerId) return [];
      return [{ category: str(category.name) ?? "", label: str(category.displayName) ?? "", teamId, playerId, name: str(athlete.displayName) ?? "", headshot: str(obj(athlete.headshot).href), value: str(top.displayValue) ?? "" }];
    });
  });
}

function parsePlays(raw: unknown): PlayText[] {
  return arr(raw).map(obj).slice(-40).map((play) => ({
    id: str(play.id) ?? "",
    text: str(play.text) ?? str(play.shortDescription) ?? "",
    clock: str(obj(play.clock).displayValue),
    period: num(obj(play.period).number),
    scoring: play.scoringPlay === true,
    teamId: str(obj(play.team).id),
    type: str(obj(play.type).text),
  })).filter((play) => play.text).reverse();
}

/** NBA/NFL timeouts and team fouls from the summary `situation` node, when ESPN publishes it. */
function applyTeamSituation(game: ProviderLiveGame, raw: unknown): void {
  const node = obj(raw);
  if (!Object.keys(node).length) return;
  game.situation = parseSituation(node, game.situation);
  const fouls = (side: unknown) => obj(side);
  game.home.timeouts = num(node.homeTimeouts) ?? game.home.timeouts;
  game.away.timeouts = num(node.awayTimeouts) ?? game.away.timeouts;
  const homeFouls = fouls(node.homeFouls);
  const awayFouls = fouls(node.awayFouls);
  game.home.fouls = num(homeFouls.teamFouls) ?? game.home.fouls;
  game.away.fouls = num(awayFouls.teamFouls) ?? game.away.fouls;
  const bonus = (value: unknown) => (str(value) ? !/none/i.test(str(value)!) : null);
  game.home.inBonus = bonus(homeFouls.bonusState) ?? game.home.inBonus;
  game.away.inBonus = bonus(awayFouls.bonusState) ?? game.away.inBonus;
}

export async function fetchGameDetail(league: League, eventId: string): Promise<ProviderGameDetail> {
  const payload = await fetchJson<Json>(`${SITE_API}/apis/site/v2/sports/${PATHS[league]}/summary?event=${encodeURIComponent(eventId)}`);
  const header = obj(payload.header);
  const game = normalizeEvent(league, { ...header, id: header.id ?? eventId });
  if (!game) throw new StatsProviderError("Game not found", 404);
  applyTeamSituation(game, payload.situation);
  const box = parseBox(league, payload.boxscore);
  const teamStats = parseTeamStats(payload.boxscore, game.home.id);
  if (league === "nhl") {
    const shots = teamStats.find((line) => line.key === "shotsTotal");
    if (shots) { game.home.shots = num(shots.home); game.away.shots = num(shots.away); }
  }
  // NFL summaries group plays by drive instead of a flat list.
  const drives = obj(payload.drives);
  const drivePlays = [...arr(drives.previous).map(obj), ...(Object.keys(obj(drives.current)).length ? [obj(drives.current)] : [])].flatMap((drive) => arr(drive.plays));
  const plays = parsePlays(arr(payload.plays).length ? payload.plays : drivePlays);
  if (league === "nhl") {
    game.situation.penalties = plays.filter((play) => /penalty/i.test(play.type ?? "") && play.period === game.period).slice(0, 4).map((play) => `${play.clock ? `${play.clock} · ` : ""}${play.text}`);
  }
  if (!game.situation.lastPlay && plays[0]) game.situation.lastPlay = plays[0].text;
  const winProbability = arr(payload.winprobability).map(obj).map((point) => ({ home: num(point.homeWinPercentage) ?? 0.5, playId: str(point.playId) ?? "" }));
  if (winProbability.length) game.homeWinProbability = winProbability[winProbability.length - 1]!.home;
  const pickcenter = parseEspnOdds(arr(payload.pickcenter)[0]);
  if (pickcenter.current) game.espnOdds = pickcenter;
  return { game, teamStats, box, leaders: parseLeaders(payload.leaders), plays: plays.slice(0, 12), winProbability, pickcenter };
}

/* ---------- NHL official API: power play ---------- */

const NHL_ABBR: Record<string, string> = { LA: "LAK", NJ: "NJD", SJ: "SJS", TB: "TBL", UTAH: "UTA", WAS: "WSH" };
export const nhlAbbr = (espn: string) => NHL_ABBR[espn.toUpperCase()] ?? espn.toUpperCase();

export interface NhlSituation { homeAbbr: string; awayAbbr: string; powerPlayAbbr: string | null; strength: string | null; timeRemaining: string | null; homeShots: number | null; awayShots: number | null }

/** Live strength situations from the NHL's score feed, keyed by "AWAY@HOME" (NHL abbreviations). */
export async function fetchNhlSituations(): Promise<Map<string, NhlSituation>> {
  const date = easternDate(0);
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const payload = await fetchJson<{ games?: Json[] }>(`${NHL_API}/v1/score/${iso}`);
  const map = new Map<string, NhlSituation>();
  for (const game of arr(payload.games).map(obj)) {
    const home = obj(game.homeTeam);
    const away = obj(game.awayTeam);
    const situation = obj(game.situation);
    const homeSit = obj(situation.homeTeam);
    const awaySit = obj(situation.awayTeam);
    const ppHome = arr(homeSit.situationDescriptions).includes("PP");
    const ppAway = arr(awaySit.situationDescriptions).includes("PP");
    const homeAbbr = str(home.abbrev) ?? "";
    const awayAbbr = str(away.abbrev) ?? "";
    const hs = num(homeSit.strength);
    const as = num(awaySit.strength);
    map.set(`${awayAbbr}@${homeAbbr}`, {
      homeAbbr, awayAbbr,
      powerPlayAbbr: ppHome ? homeAbbr : ppAway ? awayAbbr : null,
      strength: hs !== null && as !== null ? (ppAway ? `${as}-on-${hs}` : `${hs}-on-${as}`) : null,
      timeRemaining: str(situation.timeRemaining),
      homeShots: num(home.sog), awayShots: num(away.sog),
    });
  }
  return map;
}
