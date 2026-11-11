import { pool } from "../db/pool";
import { fetchEspnPolls, fetchFutures, fetchKenpom, fetchNetRankings, kenpomConfigured, type FutureMarket, type Poll, type PollKey, type RankedTeam } from "../providers/ncaaData";
import { canonicalTeam } from "./simGrading";
import { cached } from "./statsCache";
import { getLeagueStats, REFRESH_MINUTES, type LeagueStatsResponse, type PlayerRow, type StatsWindow, type TeamRow } from "./stats.service";

/**
 * NCAA Division I men's basketball: rankings, conference standings, team and player directories and
 * futures. Teams, conferences and the season come from the provider on every refresh, so realignment
 * and a new season need no code change. Reference tables (ncaa_*) are kept in sync for reporting.
 */

const RANKINGS_TTL_MS = 30 * 60 * 1000;
const FUTURES_TTL_MS = 10 * 60 * 1000;
const LEAGUE = "ncaab" as const;

/** "St. John's (NY)" and "Saint John's" → "stjohns"; "Michigan St." and "Michigan State" → "michiganstate". */
export function teamKey(name: string): string {
  return canonicalTeam(name);
}

function teamIndex(teams: TeamRow[]): (name: string) => TeamRow | undefined {
  const index = new Map<string, TeamRow>();
  for (const team of teams) {
    for (const name of [team.name, team.shortName, team.abbr]) {
      const key = teamKey(name);
      if (key && !index.has(key)) index.set(key, team);
    }
  }
  return (name: string) => index.get(teamKey(name));
}

export interface RankingsResponse {
  league: "ncaab";
  season: { year: number; displayName: string };
  polls: Poll[];
  /** Polls that could not be loaded, with the reason (e.g. KenPom needs an API key). */
  unavailable: Array<{ key: PollKey; name: string; reason: string }>;
  fetchedAt: string;
  stale: boolean;
}

async function loadPolls(stats: LeagueStatsResponse): Promise<{ polls: Poll[]; unavailable: RankingsResponse["unavailable"] }> {
  const find = teamIndex(stats.teams);
  const byId = new Map(stats.teams.map((team) => [team.id, team]));
  const unavailable: RankingsResponse["unavailable"] = [];
  const reason = (error: unknown) => error instanceof Error ? error.message : "Provider unavailable";
  const [espn, net, kenpom] = await Promise.allSettled([fetchEspnPolls(), fetchNetRankings(), fetchKenpom(stats.season.year)]);
  const polls: Poll[] = [];
  if (espn.status === "fulfilled") polls.push(...espn.value);
  else unavailable.push({ key: "ap", name: "AP Top 25", reason: reason(espn.reason) }, { key: "coaches", name: "Coaches Poll", reason: reason(espn.reason) });
  if (net.status === "fulfilled" && net.value) polls.push(net.value);
  else unavailable.push({ key: "net", name: "NET rankings", reason: net.status === "rejected" ? reason(net.reason) : "The NCAA has not published NET rankings yet" });
  if (kenpom.status === "fulfilled" && kenpom.value) polls.push(kenpom.value);
  else unavailable.push({ key: "kenpom", name: "KenPom ratings", reason: !kenpomConfigured() ? "Set KENPOM_API_KEY to enable KenPom ratings (a paid KenPom API subscription)" : kenpom.status === "rejected" ? reason(kenpom.reason) : "KenPom returned no ratings" });
  const resolve = (team: RankedTeam): RankedTeam => {
    const match = team.teamId ? byId.get(team.teamId) : find(team.team);
    return match ? { ...team, teamId: match.id, abbr: team.abbr || match.abbr, logo: team.logo ?? match.logo, record: team.record || match.record } : team;
  };
  return { polls: polls.map((poll) => ({ ...poll, season: poll.season ?? (poll.key === "net" ? null : stats.season.year), teams: poll.teams.map(resolve), others: poll.others.map(resolve) })), unavailable };
}

export async function getRankings(options: { force?: boolean } = {}): Promise<RankingsResponse> {
  const stats = await getLeagueStats(LEAGUE, "season");
  const result = await cached(`ncaab:rankings:${stats.season.year}`, RANKINGS_TTL_MS, () => loadPolls(stats), { force: options.force, persist: true });
  return { league: LEAGUE, season: stats.season, polls: result.data.polls, unavailable: result.data.unavailable, fetchedAt: result.fetchedAt.toISOString(), stale: result.stale };
}

export type TeamRanks = Partial<Record<PollKey, number>>;

export async function teamRanks(): Promise<Map<string, TeamRanks>> {
  const ranks = new Map<string, TeamRanks>();
  const rankings = await getRankings().catch(() => null);
  for (const poll of rankings?.polls ?? []) {
    for (const team of poll.teams) {
      if (!team.teamId) continue;
      ranks.set(team.teamId, { ...ranks.get(team.teamId), [poll.key]: team.rank });
    }
  }
  return ranks;
}

export type NcaaTeam = TeamRow & { ranks: TeamRanks };

function matchesConference(team: Pick<TeamRow, "conference" | "conferenceAbbr">, conference?: string): boolean {
  if (!conference) return true;
  const wanted = teamKey(conference);
  return teamKey(team.conference) === wanted || teamKey(team.conferenceAbbr) === wanted || teamKey(team.conference).startsWith(wanted);
}

export async function getNcaaTeams(filters: { conference?: string; search?: string; ranked?: boolean } = {}) {
  const [stats, ranks] = await Promise.all([getLeagueStats(LEAGUE, "season"), teamRanks()]);
  const search = filters.search?.trim().toLowerCase();
  const teams: NcaaTeam[] = stats.teams
    .filter((team) => matchesConference(team, filters.conference))
    .filter((team) => !search || team.name.toLowerCase().includes(search) || team.abbr.toLowerCase() === search)
    .map((team) => ({ ...team, ranks: ranks.get(team.id) ?? {} }))
    .filter((team) => !filters.ranked || team.ranks.ap !== undefined || team.ranks.coaches !== undefined);
  return { league: LEAGUE, season: stats.season, source: stats.source, fetchedAt: stats.fetchedAt, stale: stats.stale, total: teams.length, conferences: stats.filters.conferences, teamColumns: stats.teamColumns, teams };
}

export interface ConferenceStanding {
  conference: string;
  abbr: string;
  teams: Array<Pick<NcaaTeam, "id" | "name" | "shortName" | "abbr" | "logo" | "record" | "conferenceRecord" | "home" | "away" | "streak" | "winPct" | "ranks">>;
}

const winsOf = (record: string) => Number(record.split("-")[0]) || 0;
const pctOf = (record: string) => { const [wins = 0, losses = 0] = record.split("-").map(Number); return wins + losses ? wins / (wins + losses) : -1; };

export async function getConferenceStandings(conference?: string): Promise<ConferenceStanding[]> {
  const { teams } = await getNcaaTeams({ conference });
  const groups = new Map<string, ConferenceStanding>();
  for (const team of teams) {
    const group = groups.get(team.conference) ?? { conference: team.conference, abbr: team.conferenceAbbr, teams: [] };
    group.teams.push({ id: team.id, name: team.name, shortName: team.shortName, abbr: team.abbr, logo: team.logo, record: team.record, conferenceRecord: team.conferenceRecord, home: team.home, away: team.away, streak: team.streak, winPct: team.winPct, ranks: team.ranks });
    groups.set(team.conference, group);
  }
  for (const group of groups.values()) {
    // Conference record first (once league play starts), then overall winning percentage.
    group.teams.sort((a, b) => pctOf(b.conferenceRecord) - pctOf(a.conferenceRecord) || winsOf(b.conferenceRecord) - winsOf(a.conferenceRecord) || (b.winPct ?? 0) - (a.winPct ?? 0));
  }
  return [...groups.values()].sort((a, b) => a.conference.localeCompare(b.conference));
}

export async function getNcaaStats(filters: { conference?: string; window?: StatsWindow } = {}) {
  const stats = await getLeagueStats(LEAGUE, filters.window ?? "season");
  const { teams } = await getNcaaTeams({ conference: filters.conference });
  const teamIds = new Set(teams.map((team) => team.id));
  return {
    league: LEAGUE,
    name: stats.name,
    season: stats.season,
    window: stats.window,
    source: stats.source,
    fetchedAt: stats.fetchedAt,
    nextRefreshAt: stats.nextRefreshAt,
    stale: stats.stale,
    conferences: stats.filters.conferences,
    teamColumns: stats.teamColumns,
    playerColumns: stats.groups[0]?.columns ?? [],
    teams,
    leaders: stats.leaders,
    playerCount: stats.players.filter((player) => !filters.conference || teamIds.has(player.teamId)).length,
    standings: await getConferenceStandings(filters.conference),
  };
}

export interface PlayerFilters {
  team?: string;
  conference?: string;
  position?: string;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
  window?: StatsWindow;
}

export async function getNcaaPlayers(filters: PlayerFilters = {}) {
  const stats = await getLeagueStats(LEAGUE, filters.window ?? "season");
  const columns = stats.groups[0]?.columns ?? [];
  const teams = new Map(stats.teams.map((team) => [team.id, team]));
  const search = filters.search?.trim().toLowerCase();
  const sortKey = columns.some((column) => column.key === filters.sort) ? filters.sort! : "pts";
  const direction = filters.order ?? columns.find((column) => column.key === sortKey)?.direction ?? "desc";
  const rows = stats.players
    .filter((player) => !filters.team || player.teamId === filters.team || player.teamAbbr.toLowerCase() === filters.team.toLowerCase())
    .filter((player) => !filters.conference || matchesConference(teams.get(player.teamId) ?? { conference: "", conferenceAbbr: "" }, filters.conference))
    .filter((player) => !filters.position || player.position.toLowerCase() === filters.position.toLowerCase())
    .filter((player) => !search || player.name.toLowerCase().includes(search))
    .sort((a, b) => {
      const left = a.values[sortKey];
      const right = b.values[sortKey];
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      return direction === "asc" ? left - right : right - left;
    });
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.min(500, Math.max(1, filters.limit ?? 50));
  return {
    league: LEAGUE,
    season: stats.season,
    window: stats.window,
    source: stats.source,
    fetchedAt: stats.fetchedAt,
    stale: stats.stale,
    columns,
    sort: sortKey,
    order: direction,
    total: rows.length,
    offset,
    limit,
    players: rows.slice(offset, offset + limit).map((player: PlayerRow) => ({ ...player, conference: teams.get(player.teamId)?.conference ?? "" })),
  };
}

/* ---------- Futures ---------- */

export interface FuturesResponse {
  league: "ncaab";
  season: { year: number; displayName: string };
  source: string;
  fetchedAt: string;
  stale: boolean;
  markets: FutureMarket[];
}

export async function getFutures(options: { force?: boolean } = {}): Promise<FuturesResponse> {
  const stats = await getLeagueStats(LEAGUE, "season");
  const names = new Map(stats.teams.map((team) => [team.id, team.shortName || team.name]));
  const result = await cached(`ncaab:futures:${stats.season.year}`, FUTURES_TTL_MS, () => fetchFutures(stats.season.year, { team: (id) => names.get(id) ?? null }), { force: options.force });
  return { league: LEAGUE, season: stats.season, source: "DraftKings futures via ESPN", fetchedAt: result.fetchedAt.toISOString(), stale: result.stale, markets: result.data };
}

/** Conference of a team by display name (e.g. an odds-board team), or "" when it is not a Division I program. */
export async function conferenceLookup(): Promise<(teamName: string) => string> {
  const stats = await getLeagueStats(LEAGUE, "season").catch(() => null);
  if (!stats) return () => "";
  const find = teamIndex(stats.teams);
  return (name: string) => find(name)?.conference ?? "";
}

/* ---------- Reference tables ---------- */

const col = <T, V>(rows: T[], pick: (row: T) => V) => rows.map(pick);

/** Mirrors the cached league dataset and rankings into the ncaa_* tables. */
export async function syncNcaaTables(): Promise<{ teams: number; players: number; conferences: number; rankings: number }> {
  const stats = await getLeagueStats(LEAGUE, "season");
  const season = stats.season.year;
  const conferences = [...new Map(stats.teams.filter((team) => team.conference).map((team) => [team.conferenceAbbr || teamKey(team.conference), team.conference])).entries()];
  const confId = (team: TeamRow) => team.conferenceAbbr || teamKey(team.conference);
  const client = await pool.connect();
  let rankingRows = 0;
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO ncaa_conferences(conference_id, name, season, team_count, active, updated_at)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::int[], $4::int[]), (SELECT TRUE, NOW()) AS extra
       ON CONFLICT (conference_id) DO UPDATE SET name=EXCLUDED.name, season=EXCLUDED.season, team_count=EXCLUDED.team_count, active=TRUE, updated_at=NOW()`,
      [col(conferences, ([id]) => id.slice(0, 24)), col(conferences, ([, name]) => name), col(conferences, () => season), col(conferences, ([id]) => stats.teams.filter((team) => confId(team) === id).length)],
    );
    await client.query("UPDATE ncaa_conferences SET active=FALSE WHERE season < $1 AND active", [season]);
    await client.query(
      `INSERT INTO ncaa_teams(team_id, name, short_name, abbr, logo, conference_id, conference, season, wins, losses, record, home_record, away_record, conference_record, streak, active, updated_at)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[], $9::int[], $10::int[], $11::text[], $12::text[], $13::text[], $14::text[], $15::text[]),
         (SELECT TRUE, NOW()) AS extra
       ON CONFLICT (team_id) DO UPDATE SET name=EXCLUDED.name, short_name=EXCLUDED.short_name, abbr=EXCLUDED.abbr, logo=EXCLUDED.logo, conference_id=EXCLUDED.conference_id,
         conference=EXCLUDED.conference, season=EXCLUDED.season, wins=EXCLUDED.wins, losses=EXCLUDED.losses, record=EXCLUDED.record, home_record=EXCLUDED.home_record,
         away_record=EXCLUDED.away_record, conference_record=EXCLUDED.conference_record, streak=EXCLUDED.streak, active=TRUE, updated_at=NOW()`,
      [col(stats.teams, (t) => t.id), col(stats.teams, (t) => t.name), col(stats.teams, (t) => t.shortName), col(stats.teams, (t) => t.abbr), col(stats.teams, (t) => t.logo),
        col(stats.teams, (t) => confId(t).slice(0, 24)), col(stats.teams, (t) => t.conference), col(stats.teams, () => season), col(stats.teams, (t) => t.wins), col(stats.teams, (t) => t.losses),
        col(stats.teams, (t) => t.record.slice(0, 12)), col(stats.teams, (t) => t.home.slice(0, 12)), col(stats.teams, (t) => t.away.slice(0, 12)), col(stats.teams, (t) => t.conferenceRecord.slice(0, 12)), col(stats.teams, (t) => t.streak.slice(0, 8))],
    );
    // Programs that left Division I (or have not been seen this season) stay for history but are inactive.
    await client.query("UPDATE ncaa_teams SET active=FALSE WHERE season < $1 AND active", [season]);
    await client.query(
      `INSERT INTO ncaa_players(athlete_id, name, team_id, position, headshot, season, active, updated_at)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[]), (SELECT TRUE, NOW()) AS extra
       ON CONFLICT (athlete_id) DO UPDATE SET name=EXCLUDED.name, team_id=EXCLUDED.team_id, position=EXCLUDED.position, headshot=EXCLUDED.headshot, season=EXCLUDED.season, active=TRUE, updated_at=NOW()`,
      [col(stats.players, (p) => p.id), col(stats.players, (p) => p.name.slice(0, 120)), col(stats.players, (p) => p.teamId), col(stats.players, (p) => p.position.slice(0, 8)), col(stats.players, (p) => p.headshot), col(stats.players, () => season)],
    );
    await client.query("UPDATE ncaa_players SET active=FALSE WHERE season < $1 AND active", [season]);
    const statRows = [
      ...stats.teams.map((team) => ({ type: "team", id: team.id, stats: { ...team.values, offRank: team.offRank, defRank: team.defRank, winPct: team.winPct } })),
      ...stats.players.map((player) => ({ type: "player", id: player.id, stats: player.values })),
    ];
    await client.query(
      `INSERT INTO ncaa_statistics(season, entity_type, entity_id, stats, updated_at)
       SELECT $1, t.entity_type, t.entity_id, t.stats::jsonb, NOW() FROM UNNEST($2::text[], $3::text[], $4::text[]) AS t(entity_type, entity_id, stats)
       ON CONFLICT (season, entity_type, entity_id) DO UPDATE SET stats=EXCLUDED.stats, updated_at=NOW()`,
      [season, col(statRows, (r) => r.type), col(statRows, (r) => r.id), col(statRows, (r) => JSON.stringify(r.stats))],
    );
    const rankings = await getRankings().catch(() => null);
    for (const poll of rankings?.polls ?? []) {
      const teams = [...new Map(poll.teams.map((team) => [team.team, team])).values()];
      rankingRows += teams.length;
      await client.query(
        `INSERT INTO ncaa_rankings(season, poll, release, team_name, team_id, rank, previous_rank, points, first_place_votes, record, extra, updated_at)
         SELECT $1, $2, $3, t.team_name, t.team_id, t.rank, t.previous_rank, t.points, t.votes, t.record, t.extra::jsonb, NOW()
         FROM UNNEST($4::text[], $5::text[], $6::int[], $7::int[], $8::numeric[], $9::int[], $10::text[], $11::text[]) AS t(team_name, team_id, rank, previous_rank, points, votes, record, extra)
         ON CONFLICT (season, poll, release, team_name) DO UPDATE SET team_id=EXCLUDED.team_id, rank=EXCLUDED.rank, previous_rank=EXCLUDED.previous_rank, points=EXCLUDED.points,
           first_place_votes=EXCLUDED.first_place_votes, record=EXCLUDED.record, extra=EXCLUDED.extra, updated_at=NOW()`,
        [poll.season ?? season, poll.key, poll.release.slice(0, 60), col(teams, (t) => t.team.slice(0, 120)), col(teams, (t) => t.teamId), col(teams, (t) => t.rank), col(teams, (t) => t.previousRank),
          col(teams, (t) => t.points), col(teams, (t) => t.firstPlaceVotes), col(teams, (t) => t.record.slice(0, 12)), col(teams, (t) => JSON.stringify(t.extra))],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { teams: stats.teams.length, players: stats.players.length, conferences: conferences.length, rankings: rankingRows };
}

/** Keeps the ncaa_* tables in step with the stats refresh (which already re-reads the season, teams and conferences). */
export function startNcaaSync(): () => void {
  if (process.env.STATS_AUTO_REFRESH === "false") return () => undefined;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await syncNcaaTables();
      console.info(`NCAA sync: ${result.teams} teams, ${result.conferences} conferences, ${result.players} players, ${result.rankings} ranking rows`);
    } catch (error) {
      console.warn("NCAA table sync failed", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  const initial = setTimeout(() => void run(), 45_000);
  const interval = setInterval(() => void run(), REFRESH_MINUTES * 60 * 1000);
  initial.unref();
  interval.unref();
  return () => { clearTimeout(initial); clearInterval(interval); };
}
