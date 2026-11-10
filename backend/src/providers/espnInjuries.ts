/**
 * Injury report adapter: ESPN's league injury feeds (team-by-team reports with status, injury
 * type, body part, side, expected return and beat-writer notes) and athlete overview feeds
 * (latest player news). No API key required.
 */
import { StatsProviderError, type League } from "./espnStats";

const SITE_API = (process.env.ESPN_SITE_API_URL ?? "https://site.api.espn.com").replace(/\/+$/, "");
const WEB_API = (process.env.ESPN_WEB_API_URL ?? "https://site.web.api.espn.com").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.STATS_PROVIDER_TIMEOUT_MS ?? 20000);
const PATHS: Record<League, string> = { nba: "basketball/nba", nfl: "football/nfl", mlb: "baseball/mlb", nhl: "hockey/nhl" };

async function fetchJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "SharpStatsPro/1.5 (+injury research)" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new StatsProviderError(`Injury provider unreachable: ${error instanceof Error ? error.message : "network error"}`);
  }
  if (!response.ok) throw new StatsProviderError(`Injury provider request failed (${response.status})`, response.status);
  return response.json() as Promise<T>;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" ? value as Json : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

export const INJURY_STATUSES = [
  "Out", "Doubtful", "Questionable", "Game Time Decision", "Probable", "Day-to-Day", "Injured Reserve", "Suspended", "Inactive", "Active",
] as const;
export type InjuryStatus = typeof INJURY_STATUSES[number];

/**
 * Maps provider wording to one status. "Active" rows are players the team lists as cleared
 * (returning); a "game-time decision" note upgrades a Questionable/Day-to-Day listing.
 */
export function normalizeStatus(raw: string | null, typeName: string | null, comment: string): InjuryStatus {
  const text = `${raw ?? ""} ${typeName ?? ""}`.toLowerCase();
  if (/suspen/.test(text)) return "Suspended";
  if (/injured reserve|\bir\b|injured list|\d+-day il|\bil\b|_ir\b|reserve/.test(text)) return "Injured Reserve";
  if (/inactive/.test(text)) return "Inactive";
  if (/doubtful/.test(text)) return "Doubtful";
  if (/probable/.test(text)) return "Probable";
  if (/questionable|day-to-day|day to day|daytoday/.test(text)) {
    if (/game-time decision|game time decision|gametime decision/i.test(comment)) return "Game Time Decision";
    return /questionable/.test(text) ? "Questionable" : "Day-to-Day";
  }
  if (/\bout\b|_out\b/.test(text)) return "Out";
  if (/active/.test(text)) return "Active";
  return "Questionable";
}

export interface ProviderInjury {
  id: string;
  league: League;
  athleteId: string;
  name: string;
  headshot: string | null;
  position: string;
  positionName: string;
  teamId: string;
  teamAbbr: string;
  teamName: string;
  /** Team nickname ("Red Sox"), used to match sportsbook team names. */
  teamNickname: string;
  teamLogo: string | null;
  status: InjuryStatus;
  providerStatus: string;
  injuryType: string | null;
  location: string | null;
  detail: string | null;
  side: string | null;
  returnDate: string | null;
  shortComment: string;
  longComment: string;
  reportedAt: string;
  source: string;
}

const clean = (value: string | null) => (value && !/^not specified$/i.test(value) ? value : null);

export function normalizeInjury(league: League, team: Json, raw: Json): ProviderInjury | null {
  const athlete = obj(raw.athlete);
  const athleteTeam = obj(athlete.team);
  const link = arr(athlete.links).map(obj).map((item) => str(item.href) ?? "").find((href) => /\/id\/\d+/.test(href)) ?? "";
  const athleteId = /\/id\/(\d+)/.exec(link)?.[1] ?? str(athlete.id) ?? str(raw.id);
  if (!athleteId) return null;
  const details = obj(raw.details);
  const type = obj(raw.type);
  const shortComment = str(raw.shortComment) ?? "";
  const longComment = str(raw.longComment) ?? "";
  const position = obj(athlete.position);
  const returnDate = str(details.returnDate);
  return {
    id: str(raw.id) ?? athleteId,
    league,
    athleteId,
    name: str(athlete.displayName) ?? "",
    headshot: str(obj(athlete.headshot).href),
    position: str(position.abbreviation) ?? "",
    positionName: str(position.displayName) ?? "",
    teamId: str(athleteTeam.id) ?? str(team.id) ?? "",
    teamAbbr: str(athleteTeam.abbreviation) ?? "",
    teamName: str(athleteTeam.displayName) ?? str(team.displayName) ?? "",
    teamNickname: str(athleteTeam.name) ?? (str(team.displayName) ?? "").split(" ").slice(-1)[0] ?? "",
    teamLogo: str(obj(arr(athleteTeam.logos)[0]).href),
    status: normalizeStatus(str(raw.status), str(type.description) ?? str(type.name), `${shortComment} ${longComment}`),
    providerStatus: str(raw.status) ?? str(type.description) ?? "",
    injuryType: clean(str(details.type)),
    location: clean(str(details.location)),
    detail: clean(str(details.detail)),
    side: clean(str(details.side)),
    returnDate: returnDate ? returnDate.slice(0, 10) : null,
    shortComment,
    longComment,
    reportedAt: str(raw.date) ?? new Date().toISOString(),
    source: "ESPN",
  };
}

export async function fetchLeagueInjuries(league: League): Promise<ProviderInjury[]> {
  const payload = await fetchJson<{ injuries?: Json[] }>(`${SITE_API}/apis/site/v2/sports/${PATHS[league]}/injuries`);
  return arr(payload.injuries).map(obj).flatMap((team) => arr(team.injuries).map(obj).map((raw) => normalizeInjury(league, team, raw)))
    .filter((injury): injury is ProviderInjury => Boolean(injury));
}

export interface AthleteNews { headline: string; story: string | null; published: string | null; source: string }

/** Latest player notes (Rotowire via ESPN) and news headlines for one athlete. */
export async function fetchAthleteNews(league: League, athleteId: string): Promise<AthleteNews[]> {
  const payload = await fetchJson<Json>(`${WEB_API}/apis/common/v3/sports/${PATHS[league]}/athletes/${encodeURIComponent(athleteId)}/overview`);
  const notes: AthleteNews[] = [];
  const rotowire = obj(payload.rotowire);
  const headline = str(rotowire.headline) ?? str(rotowire.description);
  if (headline) {
    const published = str(rotowire.published);
    notes.push({ headline, story: str(rotowire.story), published: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : published, source: "Rotowire via ESPN" });
  }
  for (const article of arr(payload.news).map(obj).slice(0, 6)) {
    const title = str(article.headline);
    if (!title) continue;
    notes.push({ headline: title, story: str(article.description), published: str(article.published) ?? str(article.lastModified), source: str(article.type) === "Media" ? "ESPN video" : "ESPN" });
  }
  return notes;
}
