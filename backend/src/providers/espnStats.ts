/**
 * Sports statistics provider adapters.
 *
 * ESPN's public JSON feeds (site.api.espn.com / site.web.api.espn.com) supply player, team,
 * standings, game log and career data for the NBA, NFL, MLB and NHL. The MLB Stats API
 * (statsapi.mlb.com) supplies MLB bullpen splits, which ESPN does not publish.
 * Neither requires an API key. Both are unofficial for third-party use: review their terms
 * before deploying commercially.
 */

export type League = "nba" | "nfl" | "mlb" | "nhl";
export const LEAGUES: League[] = ["nba", "nfl", "mlb", "nhl"];

const LEAGUE_PATHS: Record<League, string> = {
  nba: "basketball/nba",
  nfl: "football/nfl",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
};

const SITE_API = (process.env.ESPN_SITE_API_URL ?? "https://site.api.espn.com").replace(/\/+$/, "");
const WEB_API = (process.env.ESPN_WEB_API_URL ?? "https://site.web.api.espn.com").replace(/\/+$/, "");
const MLB_STATS_API = (process.env.MLB_STATS_API_URL ?? "https://statsapi.mlb.com").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.STATS_PROVIDER_TIMEOUT_MS ?? 20000);

export class StatsProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "StatsProviderError";
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "SharpStatsPro/1.1 (+stats research)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new StatsProviderError(`Stats provider unreachable: ${error instanceof Error ? error.message : "network error"}`);
  }
  if (!response.ok) throw new StatsProviderError(`Stats provider request failed (${response.status})`, response.status);
  return response.json() as Promise<T>;
}

/** Parses provider stat strings such as "2,246", "-", ".312" and "23:40" (returned as minutes). */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/,/g, "").replace(/%$/, "");
  if (!text || text === "-" || text === "--") return null;
  const clock = /^(\d+):(\d{1,2})$/.exec(text);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  const parsed = Number(text.startsWith("+") ? text.slice(1) : text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Baseball innings use ".1" and ".2" for thirds of an inning. */
export function inningsToDecimal(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  const whole = Math.trunc(parsed);
  const outs = Math.round((parsed - whole) * 10);
  return whole + Math.min(outs, 2) / 3;
}

export interface SeasonInfo {
  year: number;
  displayName: string;
  type: string;
}

export interface ProviderAthlete {
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
  teamLogo: string | null;
  /** Keyed `${category}.${statName}`, e.g. `offensive.avgPoints`. */
  stats: Record<string, number | null>;
  tags: string[];
}

interface ByAthleteResponse {
  pagination?: { count: number };
  requestedSeason?: { year: number; displayName: string; type?: { name?: string } };
  currentSeason?: { year: number; displayName: string; type?: { name?: string } };
  categories: Array<{ name: string; names: string[] }>;
  athletes: Array<{
    athlete: {
      id: string; displayName: string; shortName?: string; age?: number;
      headshot?: { href?: string };
      position?: { abbreviation?: string; displayName?: string };
      status?: { name?: string };
      teamId?: string; teamName?: string; teamShortName?: string;
      teamLogos?: Array<{ href: string }>;
      teams?: Array<{ id: string; abbreviation?: string; displayName?: string; logos?: Array<{ href: string }> }>;
    };
    categories: Array<{ name: string; values?: Array<number | null> }>;
  }>;
}

export interface AthletePoolQuery {
  params: string;
  tag?: string;
}

/** The provider caps pages at 1000 rows. Several sort orders cover every position group. */
export const ATHLETE_POOL_QUERIES: Record<League, AthletePoolQuery[]> = {
  nba: [
    { params: "isqualified=true&limit=1000", tag: "qualified" },
    { params: "isqualified=false&limit=1000" },
  ],
  nhl: [
    { params: "isqualified=true&limit=1000", tag: "qualified" },
    { params: "isqualified=true&limit=200&sort=defensive.savePct:desc", tag: "qualifiedGoalie" },
    { params: "isqualified=false&limit=1000" },
  ],
  mlb: [
    { params: "isqualified=true&limit=1000", tag: "qualifiedBatting" },
    { params: "isqualified=true&limit=300&sort=pitching.ERA:asc", tag: "qualifiedPitching" },
    { params: "isqualified=false&limit=1000" },
    { params: "isqualified=false&limit=1000&sort=pitching.innings:desc" },
  ],
  nfl: [
    { params: "isqualified=false&limit=150&sort=passing.passingYards:desc" },
    { params: "isqualified=false&limit=250&sort=rushing.rushingYards:desc" },
    { params: "isqualified=false&limit=300&sort=receiving.receivingYards:desc" },
    { params: "isqualified=false&limit=250&sort=defensive.sacks:desc" },
    { params: "isqualified=false&limit=250&sort=defensive.totalTackles:desc" },
    { params: "isqualified=false&limit=150&sort=defensiveInterceptions.interceptions:desc" },
  ],
};

export function normalizeAthletes(payload: ByAthleteResponse, tag?: string): ProviderAthlete[] {
  const headers = new Map(payload.categories.map((category) => [category.name, category.names]));
  return payload.athletes.map(({ athlete, categories }) => {
    const stats: Record<string, number | null> = {};
    for (const category of categories) {
      const names = headers.get(category.name) ?? [];
      (category.values ?? []).forEach((value, index) => {
        const name = names[index];
        if (!name) return;
        const key = `${category.name}.${name}`;
        if (!(key in stats)) stats[key] = typeof value === "number" && Number.isFinite(value) ? value : null;
      });
    }
    const team = athlete.teams?.[0];
    return {
      id: athlete.id,
      name: athlete.displayName,
      shortName: athlete.shortName ?? athlete.displayName,
      headshot: athlete.headshot?.href ?? null,
      position: athlete.position?.abbreviation ?? "",
      positionName: athlete.position?.displayName ?? "",
      age: typeof athlete.age === "number" ? athlete.age : null,
      status: athlete.status?.name ?? "",
      teamId: athlete.teamId ?? team?.id ?? "",
      teamAbbr: athlete.teamShortName ?? team?.abbreviation ?? "",
      teamName: team?.displayName ?? athlete.teamName ?? "",
      teamLogo: athlete.teamLogos?.[0]?.href ?? team?.logos?.[0]?.href ?? null,
      stats,
      tags: tag ? [tag] : [],
    };
  });
}

function seasonFrom(payload: ByAthleteResponse): SeasonInfo | null {
  const season = payload.requestedSeason ?? payload.currentSeason;
  return season ? { year: season.year, displayName: season.displayName, type: "Regular Season" } : null;
}

async function fetchByAthlete(league: League, params: string): Promise<ByAthleteResponse> {
  return fetchJson<ByAthleteResponse>(
    `${WEB_API}/apis/common/v3/sports/${LEAGUE_PATHS[league]}/statistics/byathlete?region=us&lang=en&contentorigin=espn&seasontype=2&${params}`,
  );
}

/**
 * Loads every player with regular-season statistics. If the league has rolled into a new
 * season that has no games yet, it falls back to the most recent completed season.
 */
export async function fetchAthletePool(league: League): Promise<{ season: SeasonInfo; athletes: ProviderAthlete[] }> {
  const queries = ATHLETE_POOL_QUERIES[league];
  let seasonParam = "";
  let first = await fetchByAthlete(league, queries[0]!.params);
  let season = seasonFrom(first);
  if (!first.athletes.length && season) {
    seasonParam = `&season=${season.year - 1}`;
    first = await fetchByAthlete(league, `${queries[0]!.params}${seasonParam}`);
    season = seasonFrom(first);
  } else if (season) {
    seasonParam = `&season=${season.year}`;
  }
  // Supplementary sort orders widen coverage; one failing must not discard the rest.
  const rest = await Promise.allSettled(queries.slice(1).map((query) => fetchByAthlete(league, `${query.params}${seasonParam}`)));
  const merged = new Map<string, ProviderAthlete>();
  const payloads = [first, ...rest.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    console.warn(`Stats pool query skipped for ${league}: ${queries[index + 1]!.params}`, result.reason instanceof Error ? result.reason.message : result.reason);
    return null;
  })];
  payloads.forEach((payload, index) => {
    if (!payload) return;
    for (const athlete of normalizeAthletes(payload, queries[index]!.tag)) {
      const existing = merged.get(athlete.id);
      if (existing) existing.tags = [...new Set([...existing.tags, ...athlete.tags])];
      else merged.set(athlete.id, athlete);
    }
  });
  if (!season) throw new StatsProviderError("Stats provider did not report a season");
  return { season, athletes: [...merged.values()] };
}

export interface ProviderStanding {
  teamId: string;
  name: string;
  shortName: string;
  abbr: string;
  logo: string | null;
  conference: string;
  conferenceAbbr: string;
  division: string;
  stats: Record<string, { value: number | null; display: string }>;
}

interface StandingsNode {
  name?: string;
  abbreviation?: string;
  isConference?: boolean;
  children?: StandingsNode[];
  standings?: {
    entries?: Array<{
      team: { id: string; displayName: string; shortDisplayName?: string; abbreviation: string; logos?: Array<{ href: string }> };
      stats: Array<{ name?: string; type?: string; value?: number; displayValue?: string }>;
    }>;
  };
}

export function normalizeStandings(root: StandingsNode): ProviderStanding[] {
  const rows: ProviderStanding[] = [];
  const walk = (node: StandingsNode, conference: StandingsNode | null) => {
    const nextConference = conference ?? (node.children?.length && node !== root ? node : null);
    for (const entry of node.standings?.entries ?? []) {
      const stats: ProviderStanding["stats"] = {};
      for (const stat of entry.stats) {
        const key = stat.type ?? stat.name;
        if (!key || key in stats) continue;
        stats[key] = { value: typeof stat.value === "number" ? stat.value : null, display: stat.displayValue ?? "" };
      }
      rows.push({
        teamId: entry.team.id,
        name: entry.team.displayName,
        shortName: entry.team.shortDisplayName ?? entry.team.displayName,
        abbr: entry.team.abbreviation,
        logo: entry.team.logos?.[0]?.href ?? null,
        conference: nextConference?.name ?? "",
        conferenceAbbr: nextConference?.abbreviation ?? "",
        division: node.name ?? "",
        stats,
      });
    }
    for (const child of node.children ?? []) walk(child, nextConference);
  };
  walk(root, null);
  return rows;
}

export async function fetchStandings(league: League, season: number): Promise<ProviderStanding[]> {
  const root = await fetchJson<StandingsNode>(
    `${SITE_API}/apis/v2/sports/${LEAGUE_PATHS[league]}/standings?level=3&season=${season}&seasontype=2`,
  );
  return normalizeStandings(root);
}

export interface ProviderTeamStats {
  own: Record<string, number | null>;
  opponent: Record<string, number | null>;
}

interface ByTeamResponse {
  categories: Array<{ name: string; names?: string[] }>;
  teams: Array<{
    team: { id: string };
    categories: Array<{ name: string; displayName?: string; values?: Array<number | null> }>;
  }>;
}

export function normalizeTeamStats(payload: ByTeamResponse): Map<string, ProviderTeamStats> {
  const headers = new Map(payload.categories.filter((category) => category.names).map((category) => [category.name, category.names!]));
  const result = new Map<string, ProviderTeamStats>();
  for (const { team, categories } of payload.teams) {
    const entry: ProviderTeamStats = { own: {}, opponent: {} };
    for (const category of categories) {
      const target = category.displayName?.startsWith("Opponent") ? entry.opponent : entry.own;
      const names = headers.get(category.name) ?? [];
      (category.values ?? []).forEach((value, index) => {
        const key = `${category.name}.${names[index]}`;
        if (names[index] && !(key in target)) target[key] = typeof value === "number" && Number.isFinite(value) ? value : null;
      });
    }
    result.set(team.id, entry);
  }
  return result;
}

export async function fetchTeamStats(league: League, season: number): Promise<Map<string, ProviderTeamStats>> {
  const payload = await fetchJson<ByTeamResponse>(
    `${WEB_API}/apis/common/v3/sports/${LEAGUE_PATHS[league]}/statistics/byteam?region=us&lang=en&contentorigin=espn&limit=50&season=${season}&seasontype=2`,
  );
  return normalizeTeamStats(payload);
}

/** MLB relief-pitching ERA by team name, from the MLB Stats API `rp` situation split. */
export async function fetchMlbBullpenEra(season: number): Promise<Map<string, number>> {
  const payload = await fetchJson<{ stats: Array<{ splits: Array<{ team: { name: string }; stat: { era?: string } }> }> }>(
    `${MLB_STATS_API}/api/v1/teams/stats?season=${season}&sportId=1&stats=statSplits&group=pitching&sitCodes=rp&gameType=R`,
  );
  const result = new Map<string, number>();
  for (const split of payload.stats[0]?.splits ?? []) {
    const era = toNumber(split.stat.era);
    if (era !== null) result.set(split.team.name.toLowerCase(), era);
  }
  return result;
}

export interface ProviderGame {
  eventId: string;
  date: string;
  week: number | null;
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

export interface ProviderGameLog {
  columns: Array<{ key: string; label: string }>;
  games: ProviderGame[];
}

interface GameLogResponse {
  names?: string[];
  labels?: string[];
  events?: Record<string, {
    id: string; gameDate: string; week?: number; atVs?: string; score?: string; gameResult?: string;
    homeTeamId?: string; awayTeamId?: string;
    team?: { id?: string };
    opponent?: { id?: string; abbreviation?: string; displayName?: string; logo?: string };
  }>;
  seasonTypes?: Array<{ displayName: string; categories?: Array<{ events?: Array<{ eventId: string; stats: string[] }> }> }>;
}

/** Splits composite provider columns such as `fieldGoalsMade-fieldGoalsAttempted` ("17-33"). */
export function normalizeGameLog(payload: GameLogResponse): ProviderGameLog {
  const names = payload.names ?? [];
  const labels = payload.labels ?? [];
  const columns = names.map((name, index) => ({ key: name, label: labels[index] ?? name }));
  const games: ProviderGame[] = [];
  const seen = new Set<string>();
  for (const seasonType of payload.seasonTypes ?? []) {
    if (!/regular season/i.test(seasonType.displayName)) continue;
    for (const category of seasonType.categories ?? []) {
      for (const row of category.events ?? []) {
        const event = payload.events?.[row.eventId];
        if (!event || seen.has(row.eventId)) continue;
        seen.add(row.eventId);
        const values: Record<string, number | null> = {};
        const display: Record<string, string> = {};
        names.forEach((name, index) => {
          const raw = row.stats[index] ?? "";
          display[name] = raw;
          const parts = name.split("-");
          const rawParts = raw.split("-");
          if (parts.length > 1 && rawParts.length === parts.length) {
            parts.forEach((part, partIndex) => { values[part] = toNumber(rawParts[partIndex]); });
          } else if (name === "innings") {
            values[name] = inningsToDecimal(raw);
          } else {
            values[name] = toNumber(raw);
          }
        });
        games.push({
          eventId: row.eventId,
          date: event.gameDate,
          week: typeof event.week === "number" ? event.week : null,
          home: event.atVs ? event.atVs !== "@" : event.homeTeamId === event.team?.id,
          opponentId: event.opponent?.id ?? "",
          opponentAbbr: event.opponent?.abbreviation ?? "",
          opponentName: event.opponent?.displayName ?? "",
          opponentLogo: event.opponent?.logo ?? null,
          result: event.gameResult ?? "",
          score: event.score ?? "",
          values,
          display,
        });
      }
    }
  }
  games.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return { columns, games };
}

export async function fetchGameLog(league: League, athleteId: string, season: number, category?: "batting" | "pitching"): Promise<ProviderGameLog> {
  const categoryParam = category ? `&category=${category}` : "";
  const payload = await fetchJson<GameLogResponse>(
    `${WEB_API}/apis/common/v3/sports/${LEAGUE_PATHS[league]}/athletes/${encodeURIComponent(athleteId)}/gamelog?season=${season}${categoryParam}`,
  );
  return normalizeGameLog(payload);
}

export interface ProviderAthleteBio {
  id: string;
  name: string;
  headshot: string | null;
  jersey: string;
  position: string;
  positionName: string;
  height: string;
  weight: string;
  age: number | null;
  birthDate: string;
  status: string;
  experience: string;
  teamId: string;
  teamName: string;
  teamAbbr: string;
  teamLogo: string | null;
  teamColor: string | null;
}

export async function fetchAthleteBio(league: League, athleteId: string): Promise<ProviderAthleteBio> {
  const payload = await fetchJson<{
    athlete: {
      id: string; displayName: string; jersey?: string; displayHeight?: string; displayWeight?: string; age?: number;
      displayDOB?: string; headshot?: { href?: string }; position?: { abbreviation?: string; displayName?: string };
      status?: { name?: string }; displayExperience?: string;
      team?: { id?: string; displayName?: string; abbreviation?: string; color?: string; logos?: Array<{ href: string }> };
    };
  }>(`${WEB_API}/apis/common/v3/sports/${LEAGUE_PATHS[league]}/athletes/${encodeURIComponent(athleteId)}`);
  const athlete = payload.athlete;
  return {
    id: athlete.id,
    name: athlete.displayName,
    headshot: athlete.headshot?.href ?? null,
    jersey: athlete.jersey ?? "",
    position: athlete.position?.abbreviation ?? "",
    positionName: athlete.position?.displayName ?? "",
    height: athlete.displayHeight ?? "",
    weight: athlete.displayWeight ?? "",
    age: typeof athlete.age === "number" ? athlete.age : null,
    birthDate: athlete.displayDOB ?? "",
    status: athlete.status?.name ?? "",
    experience: athlete.displayExperience ?? "",
    teamId: athlete.team?.id ?? "",
    teamName: athlete.team?.displayName ?? "",
    teamAbbr: athlete.team?.abbreviation ?? "",
    teamLogo: athlete.team?.logos?.[0]?.href ?? null,
    teamColor: athlete.team?.color ? `#${athlete.team.color}` : null,
  };
}

export interface ProviderCareer {
  category: string;
  columns: Array<{ key: string; label: string }>;
  seasons: Array<{ year: number; label: string; teamId: string; values: Record<string, number | null> }>;
}

export async function fetchCareer(league: League, athleteId: string, category?: "batting" | "pitching"): Promise<ProviderCareer | null> {
  const payload = await fetchJson<{
    categories?: Array<{
      name: string; displayName?: string; names?: string[]; labels?: string[];
      statistics?: Array<{ teamId?: string; season?: { year: number; displayName: string }; stats: string[] }>;
    }>;
  }>(`${WEB_API}/apis/common/v3/sports/${LEAGUE_PATHS[league]}/athletes/${encodeURIComponent(athleteId)}/stats${category ? `?category=${category}` : ""}`);
  const primary = (payload.categories ?? []).find((item) => !item.name.startsWith("postseason") && !item.name.startsWith("opponent") && item.names?.length && item.statistics?.length);
  if (!primary) return null;
  const names = primary.names!;
  const bySeason = new Map<number, ProviderCareer["seasons"][number]>();
  for (const row of primary.statistics ?? []) {
    if (!row.season) continue;
    const values: Record<string, number | null> = {};
    names.forEach((name, index) => {
      const raw = row.stats[index] ?? "";
      const parts = name.split("-");
      const rawParts = raw.split("-");
      if (parts.length > 1 && rawParts.length === parts.length) parts.forEach((part, partIndex) => { values[part] = toNumber(rawParts[partIndex]); });
      else values[name] = name === "innings" ? inningsToDecimal(raw) : toNumber(raw);
    });
    // Players traded mid-season appear once per team; keep the latest row per season.
    bySeason.set(row.season.year, { year: row.season.year, label: row.season.displayName, teamId: row.teamId ?? "", values });
  }
  return {
    category: (primary.displayName ?? primary.name).trim(),
    columns: names.map((name, index) => ({ key: name, label: primary.labels?.[index] ?? name })),
    seasons: [...bySeason.values()].sort((a, b) => a.year - b.year),
  };
}

export interface ProviderTeamGame {
  eventId: string;
  date: string;
  home: boolean;
  opponentId: string;
  opponentAbbr: string;
  opponentLogo: string | null;
  pointsFor: number;
  pointsAgainst: number;
  result: "W" | "L" | "T";
}

export async function fetchTeamSchedule(league: League, teamId: string, season: number): Promise<ProviderTeamGame[]> {
  const payload = await fetchJson<{
    events?: Array<{
      id: string; date: string;
      competitions: Array<{
        status?: { type?: { completed?: boolean } };
        competitors: Array<{
          homeAway: string; winner?: boolean;
          team: { id: string; abbreviation?: string; logos?: Array<{ href: string }> };
          score?: { value?: number; displayValue?: string } | string;
        }>;
      }>;
    }>;
  }>(`${SITE_API}/apis/site/v2/sports/${LEAGUE_PATHS[league]}/teams/${encodeURIComponent(teamId)}/schedule?season=${season}&seasontype=2`);
  const scoreOf = (score: unknown) => typeof score === "string" ? toNumber(score) : toNumber((score as { value?: number; displayValue?: string } | undefined)?.value ?? (score as { displayValue?: string } | undefined)?.displayValue);
  const games: ProviderTeamGame[] = [];
  for (const event of payload.events ?? []) {
    const competition = event.competitions[0];
    if (!competition?.status?.type?.completed) continue;
    const us = competition.competitors.find((item) => item.team.id === teamId);
    const them = competition.competitors.find((item) => item.team.id !== teamId);
    const pointsFor = scoreOf(us?.score);
    const pointsAgainst = scoreOf(them?.score);
    if (!us || !them || pointsFor === null || pointsAgainst === null) continue;
    games.push({
      eventId: event.id,
      date: event.date,
      home: us.homeAway === "home",
      opponentId: them.team.id,
      opponentAbbr: them.team.abbreviation ?? "",
      opponentLogo: them.team.logos?.[0]?.href ?? null,
      pointsFor,
      pointsAgainst,
      result: pointsFor === pointsAgainst ? "T" : (us.winner ?? pointsFor > pointsAgainst) ? "W" : "L",
    });
  }
  return games.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
