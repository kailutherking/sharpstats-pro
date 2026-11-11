import { pool } from "../db/pool";
import {
  fetchAthleteBio, fetchAthletePool, fetchCareer, fetchGameLog, fetchMlbBullpenEra, fetchStandings, fetchTeamSchedule, fetchTeamStats,
  LEAGUES, StatsProviderError, type League, type ProviderAthlete, type ProviderAthleteBio, type ProviderCareer, type ProviderGame, type ProviderGameLog,
  type ProviderTeamGame, type ProviderTeamStats, type SeasonInfo,
} from "../providers/espnStats";
import { cached, type Cached } from "./statsCache";
import { buildPropMetrics, buildSplits, generateInsights, generateTeamInsights, type Insight, type PropMetric, type SplitRow } from "./statsInsights";
import { teamTrends, type TeamTrends } from "./ncaaTrends";
import { LEAGUE_DEFINITIONS, primaryGroup, usageRate, type LeagueDefinition, type MetricDef, type PlayerGroupDef, type StatFormat, type TeamMetricDef } from "./statsMetrics";

export type StatsWindow = "season" | "last10" | "last30";
export const STATS_WINDOWS: StatsWindow[] = ["season", "last10", "last30"];

export const REFRESH_MINUTES = Math.max(1, Number(process.env.STATS_REFRESH_MINUTES ?? 15) || 15);
const REFRESH_MS = REFRESH_MINUTES * 60 * 1000;
const BIO_TTL_MS = 6 * 60 * 60 * 1000;
const CAREER_TTL_MS = 12 * 60 * 60 * 1000;
const WINDOW_GROUP_DEPTH = 20;
const WINDOW_LEADER_DEPTH = 8;
const PROVIDER_CONCURRENCY = 6;
export const STATS_SOURCE = "ESPN public stats feeds · MLB Stats API (bullpen splits)";
export const NCAA_STATS_SOURCE = "ESPN public stats feeds (NCAA Division I) · DraftKings closing lines via ESPN";
const sourceFor = (league: League) => league === "ncaab" ? NCAA_STATS_SOURCE : STATS_SOURCE;

export interface ColumnMeta {
  key: string;
  label: string;
  short: string;
  format: StatFormat;
  direction: "asc" | "desc";
}

export interface PlayerRow {
  id: string;
  name: string;
  shortName: string;
  headshot: string | null;
  position: string;
  positionName: string;
  age: number | null;
  status: string;
  teamId: string;
  teamAbbr: string;
  teamName: string;
  groups: string[];
  tags: string[];
  values: Record<string, number | null>;
  /** Games in the selected window (form views only). */
  sample?: number;
}

export interface LeaderEntry {
  rank: number;
  id: string;
  name: string;
  shortName: string;
  headshot: string | null;
  teamAbbr: string;
  position: string;
  value: number;
  sample?: number;
}

export interface LeaderBoard extends ColumnMeta {
  group: string;
  leaders: LeaderEntry[];
}

export interface TeamRow {
  id: string;
  name: string;
  shortName: string;
  abbr: string;
  logo: string | null;
  conference: string;
  conferenceAbbr: string;
  division: string;
  wins: number;
  losses: number;
  ties: number;
  otLosses: number;
  gamesPlayed: number;
  record: string;
  home: string;
  away: string;
  /** Record against conference opponents (college and NBA). */
  conferenceRecord: string;
  winPct: number | null;
  streak: string;
  last10: string;
  values: Record<string, number | null>;
  offRank: number | null;
  defRank: number | null;
}

interface LeagueBase {
  season: SeasonInfo;
  players: PlayerRow[];
  leaders: LeaderBoard[];
  teams: TeamRow[];
}

export interface LeagueStatsResponse {
  league: League;
  name: string;
  season: SeasonInfo;
  window: StatsWindow;
  windowNote: string | null;
  source: string;
  fetchedAt: string;
  nextRefreshAt: string;
  refreshMinutes: number;
  stale: boolean;
  groups: Array<{ key: string; label: string; primary: string; columns: ColumnMeta[] }>;
  leaders: LeaderBoard[];
  players: PlayerRow[];
  teams: TeamRow[];
  teamColumns: ColumnMeta[];
  offenseMetric: string;
  defenseMetric: string;
  unavailableMetrics: string[];
  conferenceLabel: string;
  pointsLabel: string;
  filters: {
    teams: Array<{ id: string; abbr: string; name: string; conference: string; division: string }>;
    positions: string[];
    conferences: string[];
    divisions: Array<{ name: string; conference: string }>;
  };
}

const columnMeta = (metric: MetricDef | TeamMetricDef): ColumnMeta => ({
  key: metric.key, label: metric.label, short: metric.short, format: metric.format, direction: metric.direction,
});

const compare = (direction: "asc" | "desc") => (a: number, b: number) => direction === "asc" ? a - b : b - a;

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const current = next++;
      results[current] = await worker(items[current]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function toPlayerRow(definition: LeagueDefinition, athlete: ProviderAthlete): PlayerRow | null {
  const groups = definition.groups.filter((group) => group.includes(athlete));
  if (!groups.length) return null;
  const values: Record<string, number | null> = {};
  for (const group of groups) {
    for (const key of group.columns) values[key] = definition.metrics[key]!.season(athlete.stats);
  }
  return {
    id: athlete.id,
    name: athlete.name,
    shortName: athlete.shortName,
    headshot: athlete.headshot,
    position: athlete.position,
    positionName: athlete.positionName,
    age: athlete.age,
    status: athlete.status,
    teamId: athlete.teamId,
    teamAbbr: athlete.teamAbbr,
    teamName: athlete.teamName,
    groups: groups.map((group) => group.key),
    tags: athlete.tags,
    values,
  };
}

function leaderEntry(player: PlayerRow, value: number, rank: number, sample?: number): LeaderEntry {
  return {
    rank, id: player.id, name: player.name, shortName: player.shortName, headshot: player.headshot,
    teamAbbr: player.teamAbbr, position: player.position, value, ...(sample === undefined ? {} : { sample }),
  };
}

function seasonLeaders(definition: LeagueDefinition, athletes: ProviderAthlete[], players: Map<string, PlayerRow>): LeaderBoard[] {
  return definition.leaders.map((leader) => {
    const metric = definition.metrics[leader.metric]!;
    const group = definition.groups.find((item) => item.key === leader.group)!;
    const ranked = athletes
      .filter((athlete) => group.includes(athlete) && (!leader.qualify || leader.qualify(athlete)))
      .map((athlete) => ({ athlete, value: metric.season(athlete.stats) }))
      .filter((item): item is { athlete: ProviderAthlete; value: number } => item.value !== null)
      .sort((a, b) => compare(metric.direction)(a.value, b.value))
      .slice(0, 10);
    return {
      ...columnMeta(metric),
      group: leader.group,
      leaders: ranked.map((item, index) => leaderEntry(players.get(item.athlete.id)!, item.value, index + 1)),
    };
  });
}

function buildTeams(definition: LeagueDefinition, standings: Awaited<ReturnType<typeof fetchStandings>>, teamStats: Map<string, ProviderTeamStats>, bullpen: Map<string, number>): TeamRow[] {
  const rows = standings.map((standing): TeamRow => {
    const s = standing.stats;
    const value = (key: string) => s[key]?.value ?? null;
    const display = (key: string) => (s[key]?.display ?? "").split(",")[0]!.trim();
    const wins = value("wins") ?? 0;
    const losses = value("losses") ?? 0;
    const ties = value("ties") ?? 0;
    const otLosses = value("otlosses") ?? value("overtimelosses") ?? 0;
    const gamesPlayed = value("gamesplayed") ?? wins + losses + ties + otLosses;
    const fallbackRecord = definition.league === "nhl" ? `${wins}-${losses}-${otLosses}` : ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
    const context = { standing, stats: teamStats.get(standing.teamId), gamesPlayed, extras: { bullpenEra: bullpen.get(standing.name.toLowerCase()) ?? null } };
    return {
      id: standing.teamId,
      name: standing.name,
      shortName: standing.shortName,
      abbr: standing.abbr,
      logo: standing.logo,
      conference: standing.conference,
      conferenceAbbr: standing.conferenceAbbr,
      division: standing.division,
      wins, losses, ties, otLosses, gamesPlayed,
      record: display("total") || fallbackRecord,
      home: display("home"),
      away: display("road"),
      conferenceRecord: display("vsconf"),
      winPct: value("winpercent") ?? (gamesPlayed ? wins / gamesPlayed : null),
      streak: display("streak"),
      last10: display("lasttengames"),
      values: Object.fromEntries(definition.teamMetrics.map((metric) => [metric.key, metric.compute(context)])),
      offRank: null,
      defRank: null,
    };
  });
  const rank = (key: string, field: "offRank" | "defRank") => {
    const metric = definition.teamMetrics.find((item) => item.key === key)!;
    rows.filter((row) => row.values[key] !== null)
      .sort((a, b) => compare(metric.direction)(a.values[key]!, b.values[key]!))
      .forEach((row, index) => { row[field] = index + 1; });
  };
  rank(definition.offenseMetric, "offRank");
  rank(definition.defenseMetric, "defRank");
  return rows.sort((a, b) => (b.winPct ?? 0) - (a.winPct ?? 0) || b.wins - a.wins);
}

async function buildLeagueBase(league: League): Promise<LeagueBase> {
  const definition = LEAGUE_DEFINITIONS[league];
  const { season, athletes } = await fetchAthletePool(league);
  const [standings, teamStats, bullpen] = await Promise.all([
    fetchStandings(league, season.year),
    fetchTeamStats(league, season.year).catch((error: unknown) => {
      console.warn(`Team stats unavailable for ${league}`, error instanceof Error ? error.message : error);
      return new Map<string, ProviderTeamStats>();
    }),
    league === "mlb"
      ? fetchMlbBullpenEra(season.year).catch((error: unknown) => {
        console.warn("MLB bullpen splits unavailable", error instanceof Error ? error.message : error);
        return new Map<string, number>();
      })
      : Promise.resolve(new Map<string, number>()),
  ]);
  if (league === "ncaab") {
    // ESPN does not publish usage rate; derive it from the player's and team's per-game totals.
    for (const athlete of athletes) athlete.stats["derived.usageRate"] = usageRate(athlete.stats, teamStats.get(athlete.teamId)?.own);
  }
  const rows = athletes.map((athlete) => toPlayerRow(definition, athlete)).filter((row): row is PlayerRow => row !== null);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    season,
    players: rows,
    leaders: seasonLeaders(definition, athletes.filter((athlete) => byId.has(athlete.id)), byId),
    teams: buildTeams(definition, standings, teamStats, bullpen),
  };
}

function getBase(league: League, force = false): Promise<Cached<LeagueBase>> {
  return cached(`league:${league}`, REFRESH_MS, () => buildLeagueBase(league), { force, persist: true });
}

export function windowGames(games: ProviderGame[], window: StatsWindow, now = Date.now()): ProviderGame[] {
  if (window === "last10") return games.slice(0, 10);
  if (window === "last30") return games.filter((game) => Date.parse(game.date) >= now - 30 * 24 * 60 * 60 * 1000);
  return games;
}

function getGameLog(league: League, athleteId: string, season: number, group: PlayerGroupDef, force = false) {
  return cached<ProviderGameLog>(
    `gamelog:${league}:${season}:${athleteId}:${group.gameLogCategory ?? "default"}`,
    REFRESH_MS,
    () => fetchGameLog(league, athleteId, season, group.gameLogCategory),
    { force },
  );
}

interface WindowData {
  players: PlayerRow[];
  leaders: LeaderBoard[];
  candidates: number;
}

async function buildWindow(league: League, base: LeagueBase, window: Exclude<StatsWindow, "season">): Promise<WindowData> {
  const definition = LEAGUE_DEFINITIONS[league];
  const wanted = new Map<string, Set<string>>();
  const want = (playerId: string, groupKey: string) => wanted.set(`${playerId}|${groupKey}`, new Set());
  for (const group of definition.groups) {
    const primary = definition.metrics[group.primary]!;
    base.players
      .filter((player) => player.groups.includes(group.key) && player.values[group.primary] !== null && player.values[group.primary] !== undefined)
      .sort((a, b) => compare(primary.direction)(a.values[group.primary]!, b.values[group.primary]!))
      .slice(0, WINDOW_GROUP_DEPTH)
      .forEach((player) => want(player.id, group.key));
  }
  for (const board of base.leaders) board.leaders.slice(0, WINDOW_LEADER_DEPTH).forEach((entry) => want(entry.id, board.group));

  const byId = new Map(base.players.map((player) => [player.id, player]));
  const tasks = [...wanted.keys()].map((key) => { const [id, group] = key.split("|") as [string, string]; return { id, group }; });
  const logs = await mapLimit(tasks, PROVIDER_CONCURRENCY, async (task) => {
    const group = definition.groups.find((item) => item.key === task.group)!;
    try {
      const log = await getGameLog(league, task.id, base.season.year, group);
      return { ...task, games: windowGames(log.data.games, window) };
    } catch {
      return { ...task, games: null };
    }
  });

  const rows = new Map<string, PlayerRow>();
  const samples = new Map<string, ProviderGame[]>();
  for (const log of logs) {
    const player = byId.get(log.id);
    if (!player || !log.games?.length) continue;
    const group = definition.groups.find((item) => item.key === log.group)!;
    const row = rows.get(log.id) ?? { ...player, groups: [], values: {}, sample: log.games.length };
    row.groups.push(group.key);
    for (const key of group.columns) row.values[key] = definition.metrics[key]!.window?.(log.games) ?? null;
    rows.set(log.id, row);
    samples.set(`${log.id}|${log.group}`, log.games);
  }
  const leaders = definition.leaders.map((leader): LeaderBoard => {
    const metric = definition.metrics[leader.metric]!;
    const ranked = [...rows.values()]
      .filter((row) => row.groups.includes(leader.group))
      .map((row) => ({ row, games: samples.get(`${row.id}|${leader.group}`) ?? [], value: row.values[leader.metric] ?? null }))
      .filter((item): item is { row: PlayerRow; games: ProviderGame[]; value: number } => item.value !== null && (!leader.windowQualify || leader.windowQualify(item.games)))
      .sort((a, b) => compare(metric.direction)(a.value, b.value))
      .slice(0, 10);
    return { ...columnMeta(metric), group: leader.group, leaders: ranked.map((item, index) => leaderEntry(item.row, item.value, index + 1, item.games.length)) };
  });
  return { players: [...rows.values()], leaders, candidates: tasks.length };
}

export async function getLeagueStats(league: League, window: StatsWindow = "season", options: { force?: boolean } = {}): Promise<LeagueStatsResponse> {
  const definition = LEAGUE_DEFINITIONS[league];
  const base = await getBase(league, options.force);
  let players = base.data.players;
  let leaders = base.data.leaders;
  let windowNote: string | null = null;
  if (window !== "season") {
    const form = await cached(`window:${league}:${base.data.season.year}:${window}`, REFRESH_MS, () => buildWindow(league, base.data, window), { force: options.force });
    players = form.data.players;
    leaders = form.data.leaders;
    windowNote = `${window === "last10" ? "Last 10 games" : "Last 30 days"} form, recalculated from game logs for the ${form.data.players.length} highest-volume players in each position group. Team tables use full-season data.`;
  }
  const conferences = [...new Set(base.data.teams.map((team) => team.conference).filter(Boolean))].sort();
  const divisions = [...new Map(base.data.teams.filter((team) => team.division).map((team) => [team.division, { name: team.division, conference: team.conference }])).values()]
    .sort((a, b) => a.conference.localeCompare(b.conference) || a.name.localeCompare(b.name));
  return {
    league,
    name: definition.name,
    season: base.data.season,
    window,
    windowNote,
    source: sourceFor(league),
    fetchedAt: base.fetchedAt.toISOString(),
    nextRefreshAt: new Date(base.fetchedAt.getTime() + REFRESH_MS).toISOString(),
    refreshMinutes: REFRESH_MINUTES,
    stale: base.stale,
    groups: definition.groups.map((group) => ({ key: group.key, label: group.label, primary: group.primary, columns: group.columns.map((key) => columnMeta(definition.metrics[key]!)) })),
    leaders,
    players,
    teams: base.data.teams,
    teamColumns: definition.teamMetrics.map(columnMeta),
    offenseMetric: definition.offenseMetric,
    defenseMetric: definition.defenseMetric,
    unavailableMetrics: definition.unavailableMetrics,
    conferenceLabel: definition.conferenceLabel,
    pointsLabel: definition.pointsLabel,
    filters: {
      teams: base.data.teams.map((team) => ({ id: team.id, abbr: team.abbr, name: team.name, conference: team.conference, division: team.division }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      positions: [...new Set(base.data.players.map((player) => player.position).filter(Boolean))].sort(),
      conferences,
      divisions,
    },
  };
}

export interface GameLogRow {
  eventId: string;
  date: string;
  home: boolean;
  opponentId: string;
  opponentAbbr: string;
  opponentName: string;
  opponentLogo: string | null;
  result: string;
  score: string;
  values: Record<string, number | null>;
  display: Record<string, string>;
}

export interface PlayerProfileResponse {
  league: League;
  season: SeasonInfo;
  window: StatsWindow;
  fetchedAt: string;
  stale: boolean;
  source: string;
  player: ProviderAthleteBio & { teamRecord: string | null; conference: string | null; division: string | null };
  group: { key: string; label: string; unit: "games" | "starts" | "appearances" };
  seasonStats: Array<ColumnMeta & { season: number | null; window: number | null }>;
  gameLog: { columns: Array<{ key: string; label: string }>; games: GameLogRow[]; windowEventIds: string[] };
  propMetrics: PropMetric[];
  insights: Insight[];
  splits: { homeAway: SplitRow[]; opponents: SplitRow[] };
  career: ProviderCareer | null;
}

export class NotFoundError extends Error {}

export async function getPlayerProfile(league: League, athleteId: string, window: StatsWindow = "season", options: { force?: boolean } = {}): Promise<PlayerProfileResponse> {
  const definition = LEAGUE_DEFINITIONS[league];
  const base = await getBase(league);
  const row = base.data.players.find((player) => player.id === athleteId) ?? null;
  const bio = await cached(`bio:${league}:${athleteId}`, BIO_TTL_MS, () => fetchAthleteBio(league, athleteId), { force: options.force })
    .catch((error: unknown) => {
      if (error instanceof StatsProviderError && error.status === 404) throw new NotFoundError("Player not found");
      throw error;
    });
  const group = primaryGroup(definition, row
    ? { id: row.id, position: row.position, tags: row.tags, stats: {} }
    : { id: athleteId, position: bio.data.position, tags: [], stats: {} });
  const [log, career] = await Promise.all([
    getGameLog(league, athleteId, base.data.season.year, group, options.force),
    cached(`career:${league}:${athleteId}:${group.gameLogCategory ?? "default"}`, CAREER_TTL_MS, () => fetchCareer(league, athleteId, group.gameLogCategory), { force: options.force })
      .then((result) => result.data)
      .catch(() => null),
  ]);
  const games = log.data.games;
  const selected = windowGames(games, window);
  const team = base.data.teams.find((item) => item.id === (bio.data.teamId || row?.teamId));
  const propMetrics = buildPropMetrics(games, group.props);
  const unit = group.unit({ position: bio.data.position || row?.position || "" });
  return {
    league,
    season: base.data.season,
    window,
    fetchedAt: log.fetchedAt.toISOString(),
    stale: log.stale || bio.stale,
    source: sourceFor(league),
    player: { ...bio.data, teamRecord: team?.record ?? null, conference: team?.conference ?? null, division: team?.division ?? null },
    group: { key: group.key, label: group.label, unit },
    seasonStats: group.columns.map((key) => {
      const metric = definition.metrics[key]!;
      return {
        ...columnMeta(metric),
        season: row?.values[key] ?? metric.window?.(games) ?? null,
        window: window === "season" ? null : metric.window?.(selected) ?? null,
      };
    }),
    gameLog: { columns: log.data.columns, games, windowEventIds: selected.map((game) => game.eventId) },
    propMetrics,
    insights: generateInsights(bio.data.name, unit, propMetrics),
    splits: buildSplits(selected, group.props),
    career,
  };
}

export interface TeamProfileResponse {
  league: League;
  season: SeasonInfo;
  fetchedAt: string;
  stale: boolean;
  source: string;
  team: TeamRow;
  teamColumns: ColumnMeta[];
  pointsLabel: string;
  unavailableMetrics: string[];
  games: ProviderTeamGame[];
  splits: Array<{ label: string; games: number; record: string; pointsFor: number | null; pointsAgainst: number | null }>;
  insights: Insight[];
  /** NCAA only: ATS and over/under records, recent form and strength of schedule. */
  trends?: TeamTrends;
  topPlayers: Array<{ group: string; label: string; metric: ColumnMeta; players: Array<Pick<PlayerRow, "id" | "name" | "headshot" | "position"> & { value: number }> }>;
}

export async function getTeamProfile(league: League, teamId: string, options: { force?: boolean } = {}): Promise<TeamProfileResponse> {
  const definition = LEAGUE_DEFINITIONS[league];
  const base = await getBase(league);
  const team = base.data.teams.find((item) => item.id === teamId);
  if (!team) throw new NotFoundError("Team not found");
  const schedule = await cached(`schedule:${league}:${base.data.season.year}:${teamId}`, REFRESH_MS, () => fetchTeamSchedule(league, teamId, base.data.season.year), { force: options.force });
  const games = schedule.data;
  const summarize = (label: string, subset: ProviderTeamGame[]) => {
    const wins = subset.filter((game) => game.result === "W").length;
    const ties = subset.filter((game) => game.result === "T").length;
    const losses = subset.length - wins - ties;
    const average = (pick: (game: ProviderTeamGame) => number) => subset.length ? subset.reduce((sum, game) => sum + pick(game), 0) / subset.length : null;
    return { label, games: subset.length, record: ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`, pointsFor: average((game) => game.pointsFor), pointsAgainst: average((game) => game.pointsAgainst) };
  };
  const pf = team.values.pointsForPerGame ?? null;
  const pa = team.values.pointsAgainstPerGame ?? null;
  const winPct = new Map(base.data.teams.map((item) => [item.id, item.winPct]));
  const trends = league === "ncaab"
    ? await teamTrends(games, (id) => winPct.get(id) ?? null).catch(() => undefined)
    : undefined;
  return {
    ...(trends ? { trends } : {}),
    league,
    season: base.data.season,
    fetchedAt: base.fetchedAt.toISOString(),
    stale: base.stale || schedule.stale,
    source: sourceFor(league),
    team,
    teamColumns: definition.teamMetrics.map(columnMeta),
    pointsLabel: definition.pointsLabel,
    unavailableMetrics: definition.unavailableMetrics,
    games,
    splits: [
      summarize("Season", games),
      summarize("Home", games.filter((game) => game.home)),
      summarize("Away", games.filter((game) => !game.home)),
      summarize("Last 5", games.slice(0, 5)),
      summarize("Last 10", games.slice(0, 10)),
    ],
    insights: generateTeamInsights(team.shortName || team.name, definition.pointsLabel, games, pf, pa),
    topPlayers: definition.groups.map((group) => {
      const metric = definition.metrics[group.primary]!;
      return {
        group: group.key,
        label: group.label,
        metric: columnMeta(metric),
        players: base.data.players
          .filter((player) => player.teamId === teamId && player.groups.includes(group.key) && player.values[group.primary] !== null && player.values[group.primary] !== undefined)
          .sort((a, b) => compare(metric.direction)(a.values[group.primary]!, b.values[group.primary]!))
          .slice(0, 4)
          .map((player) => ({ id: player.id, name: player.name, headshot: player.headshot, position: player.position, value: player.values[group.primary]! })),
      };
    }).filter((entry) => entry.players.length),
  };
}

/* ------------------------------- Favorites ------------------------------- */

export interface FavoriteStat {
  league: League;
  entity_type: "player" | "team";
  entity_id: string;
  name: string;
  team_abbr: string;
  image_url: string | null;
  created_at: string;
}

export async function listFavorites(userId: number): Promise<FavoriteStat[]> {
  const result = await pool.query<FavoriteStat>(
    `SELECT league, entity_type, entity_id, name, team_abbr, image_url, created_at
     FROM favorite_stats WHERE user_id=$1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows;
}

export async function setFavorite(userId: number, favorite: Omit<FavoriteStat, "created_at">, enabled: boolean): Promise<boolean> {
  if (enabled) {
    await pool.query(
      `INSERT INTO favorite_stats(user_id, league, entity_type, entity_id, name, team_abbr, image_url)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id, league, entity_type, entity_id) DO UPDATE SET name=EXCLUDED.name, team_abbr=EXCLUDED.team_abbr, image_url=EXCLUDED.image_url`,
      [userId, favorite.league, favorite.entity_type, favorite.entity_id, favorite.name, favorite.team_abbr, favorite.image_url],
    );
  } else {
    await pool.query(
      "DELETE FROM favorite_stats WHERE user_id=$1 AND league=$2 AND entity_type=$3 AND entity_id=$4",
      [userId, favorite.league, favorite.entity_type, favorite.entity_id],
    );
  }
  return enabled;
}

/* ------------------------------ Auto refresh ------------------------------ */

/**
 * Re-fetches every league from the providers on a fixed interval so user requests are served
 * from a warm cache. Leagues refresh one at a time to stay gentle on the providers.
 */
export function startStatsRefreshScheduler(): () => void {
  if (process.env.STATS_AUTO_REFRESH === "false") return () => undefined;
  let running = false;
  const refreshAll = async () => {
    if (running) return;
    running = true;
    for (const league of LEAGUES) {
      try {
        await getBase(league, true);
      } catch (error) {
        console.warn(`Scheduled ${league.toUpperCase()} stats refresh failed`, error instanceof Error ? error.message : error);
      }
    }
    running = false;
  };
  const initial = setTimeout(() => void refreshAll(), 5000);
  const interval = setInterval(() => void refreshAll(), REFRESH_MS);
  initial.unref();
  interval.unref();
  console.info(`Stats auto-refresh every ${REFRESH_MINUTES} minutes`);
  return () => { clearTimeout(initial); clearInterval(interval); };
}

/* ---------- Shared with the odds platform (prop research) ---------- */

export interface LeagueDirectory {
  season: number;
  players: Array<Pick<PlayerRow, "id" | "name" | "shortName" | "headshot" | "position" | "teamId" | "teamAbbr" | "teamName" | "groups">>;
  teams: Array<Pick<TeamRow, "id" | "name" | "shortName" | "abbr" | "logo">>;
}

/** Players and teams of the cached league dataset (no extra provider calls when warm). */
export async function getLeagueDirectory(league: League): Promise<LeagueDirectory> {
  const base = await getBase(league);
  return {
    season: base.data.season.year,
    players: base.data.players.map(({ id, name, shortName, headshot, position, teamId, teamAbbr, teamName, groups }) => ({ id, name, shortName, headshot, position, teamId, teamAbbr, teamName, groups })),
    teams: base.data.teams.map(({ id, name, shortName, abbr, logo }) => ({ id, name, shortName, abbr, logo })),
  };
}

/** A player's current-season game log (newest first) for one stat group, e.g. MLB batting vs pitching. */
export async function getPlayerGames(league: League, athleteId: string, groupKey?: string): Promise<ProviderGame[]> {
  const definition = LEAGUE_DEFINITIONS[league];
  const base = await getBase(league);
  const row = base.data.players.find((player) => player.id === athleteId);
  const group = definition.groups.find((item) => item.key === groupKey)
    ?? (row ? primaryGroup(definition, { id: row.id, position: row.position, tags: row.tags, stats: {} }) : definition.groups[0]!);
  const log = await getGameLog(league, athleteId, base.data.season.year, group);
  return log.data.games;
}
