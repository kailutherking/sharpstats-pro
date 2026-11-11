/**
 * NCAA Division I men's basketball data that the shared ESPN stats adapters do not cover:
 *
 * - AP Top 25 and Coaches Poll: ESPN's public rankings feed (no key).
 * - NET rankings: the NCAA's published table through an NCAA.com JSON mirror (NCAA_API_URL, no key).
 *   The NCAA releases the first NET of a season in early December; until then the feed returns the
 *   previous season's final table, which is labelled with its "through games" date.
 * - KenPom ratings (optional): the official KenPom API, used only when KENPOM_API_KEY is set.
 * - Futures: DraftKings conference, Final Four and national championship prices from ESPN's core API.
 * - Closing spread/total per finished game (for ATS and over/under records): ESPN's core API.
 */
import { StatsProviderError, toNumber } from "./espnStats";

const SITE_API = (process.env.ESPN_SITE_API_URL ?? "https://site.api.espn.com").replace(/\/+$/, "");
const CORE_API = (process.env.ESPN_CORE_API_URL ?? "https://sports.core.api.espn.com").replace(/\/+$/, "");
const NCAA_API = (process.env.NCAA_API_URL ?? "https://ncaa-api.henrygd.me").replace(/\/+$/, "");
const KENPOM_API = (process.env.KENPOM_API_URL ?? "https://kenpom.com/api.php").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.STATS_PROVIDER_TIMEOUT_MS ?? 20000);
const PATH = "basketball/mens-college-basketball";
const CORE_PATH = "basketball/leagues/mens-college-basketball";

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "SharpStatsPro/1.7 (+stats research)", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new StatsProviderError(`NCAA data provider unreachable: ${error instanceof Error ? error.message : "network error"}`);
  }
  if (!response.ok) throw new StatsProviderError(`NCAA data provider request failed (${response.status})`, response.status);
  return response.json() as Promise<T>;
}

/* ---------- Rankings ---------- */

export type PollKey = "ap" | "coaches" | "net" | "kenpom";

export interface RankedTeam {
  rank: number;
  previousRank: number | null;
  teamId: string | null;
  team: string;
  abbr: string;
  logo: string | null;
  record: string;
  points: number | null;
  firstPlaceVotes: number | null;
  trend: string;
  /** Poll-specific columns, e.g. NET quadrant records or KenPom efficiency and tempo. */
  extra: Record<string, string | number | null>;
}

export interface Poll {
  key: PollKey;
  name: string;
  /** What the release covers, e.g. "Week 2" or "Through Games Apr. 06 2026". */
  release: string;
  season: number | null;
  updatedAt: string | null;
  source: string;
  teams: RankedTeam[];
  /** Teams receiving votes outside the top 25 (AP and Coaches). */
  others: RankedTeam[];
}

function espnRank(raw: unknown): RankedTeam | null {
  const node = obj(raw);
  const team = obj(node.team);
  const id = str(team.id);
  if (!id) return null;
  const current = toNumber(node.current) ?? 0;
  const previous = toNumber(node.previous);
  return {
    rank: current,
    previousRank: previous && previous > 0 ? previous : null,
    teamId: id,
    team: str(team.location) || str(team.nickname) || str(team.name),
    abbr: str(team.abbreviation),
    logo: str(obj(arr(team.logos)[0]).href) || str(team.logo) || null,
    record: str(node.recordSummary),
    points: toNumber(node.points),
    firstPlaceVotes: toNumber(node.firstPlaceVotes),
    trend: str(node.trend),
    extra: {},
  };
}

export function normalizeEspnPolls(payload: unknown): Poll[] {
  const polls: Poll[] = [];
  for (const raw of arr(obj(payload).rankings).map(obj)) {
    const type = str(raw.type).toLowerCase();
    const key: PollKey | null = type === "ap" ? "ap" : type === "usa" ? "coaches" : null;
    if (!key) continue;
    const teams = arr(raw.ranks).map(espnRank).filter((team): team is RankedTeam => team !== null && team.rank > 0).sort((a, b) => a.rank - b.rank);
    const others = arr(raw.others).map(espnRank).filter((team): team is RankedTeam => team !== null)
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    polls.push({
      key,
      name: key === "ap" ? "AP Top 25" : "Coaches Poll",
      release: str(obj(raw.occurrence).displayValue) || str(raw.headline),
      season: toNumber(raw.season) ?? toNumber(obj(raw.season).year),
      updatedAt: str(raw.lastUpdated) || str(raw.date) || null,
      source: "ESPN rankings feed",
      teams,
      others,
    });
  }
  return polls;
}

export async function fetchEspnPolls(): Promise<Poll[]> {
  return normalizeEspnPolls(await fetchJson(`${SITE_API}/apis/site/v2/sports/${PATH}/rankings`));
}

export function normalizeNet(payload: unknown): Poll | null {
  const root = obj(payload);
  const teams = arr(root.data).map(obj).map((row): RankedTeam | null => {
    const rank = toNumber(row.Rank);
    const school = str(row.School);
    if (!rank || !school) return null;
    return {
      rank,
      previousRank: toNumber(row.Prev),
      teamId: null,
      team: school,
      abbr: "",
      logo: null,
      record: str(row.Record),
      points: null,
      firstPlaceVotes: null,
      trend: "",
      extra: {
        conference: str(row.Conf), road: str(row.Road), neutral: str(row.Neutral), home: str(row.Home),
        quad1: str(row["Quad 1"]), quad2: str(row["Quad 2"]), quad3: str(row["Quad 3"]), quad4: str(row["Quad 4"]),
      },
    };
  }).filter((team): team is RankedTeam => team !== null);
  if (!teams.length) return null;
  return { key: "net", name: "NET rankings", release: str(root.updated) || "Latest release", season: null, updatedAt: null, source: "NCAA.com NET rankings", teams, others: [] };
}

export async function fetchNetRankings(): Promise<Poll | null> {
  return normalizeNet(await fetchJson(`${NCAA_API}/rankings/basketball-men/d1/ncaa-mens-basketball-net-rankings`));
}

export const kenpomConfigured = () => Boolean(process.env.KENPOM_API_KEY?.trim());

/** Reads a field regardless of the provider's key casing (TeamName, teamName, team_name). */
function field(row: Json, ...names: string[]): unknown {
  const index = new Map(Object.keys(row).map((key) => [key.toLowerCase().replace(/_/g, ""), key]));
  for (const name of names) {
    const key = index.get(name.toLowerCase().replace(/_/g, ""));
    if (key !== undefined && row[key] !== null && row[key] !== undefined && row[key] !== "") return row[key];
  }
  return undefined;
}

export function normalizeKenpom(payload: unknown, season: number): Poll | null {
  const rows = (Array.isArray(payload) ? payload : arr(obj(payload).data).length ? arr(obj(payload).data) : arr(obj(payload).ratings)).map(obj);
  const teams = rows.map((row): RankedTeam | null => {
    const team = str(field(row, "TeamName", "Team"));
    const rank = toNumber(field(row, "RankAdjEM", "Rank", "Rk"));
    if (!team || !rank) return null;
    const wins = toNumber(field(row, "Wins", "W"));
    const losses = toNumber(field(row, "Losses", "L"));
    return {
      rank,
      previousRank: null,
      teamId: null,
      team,
      abbr: "",
      logo: null,
      record: wins !== null && losses !== null ? `${wins}-${losses}` : "",
      points: toNumber(field(row, "AdjEM")),
      firstPlaceVotes: null,
      trend: "",
      extra: {
        conference: str(field(row, "ConfShort", "Conf", "Conference")),
        adjEM: toNumber(field(row, "AdjEM")), adjO: toNumber(field(row, "AdjOE", "AdjO")), adjD: toNumber(field(row, "AdjDE", "AdjD")),
        adjTempo: toNumber(field(row, "AdjTempo", "AdjT")), luck: toNumber(field(row, "Luck")),
        sos: toNumber(field(row, "SOS", "SOSAdjEM")), sosRank: toNumber(field(row, "RankSOS", "RankSOSAdjEM")),
      },
    };
  }).filter((team): team is RankedTeam => team !== null).sort((a, b) => a.rank - b.rank);
  if (!teams.length) return null;
  return { key: "kenpom", name: "KenPom ratings", release: `${season - 1}-${String(season).slice(2)} adjusted efficiency`, season, updatedAt: new Date().toISOString(), source: "KenPom API", teams, others: [] };
}

/** KenPom's API is a paid product; nothing is requested unless a key is configured. */
export async function fetchKenpom(season: number): Promise<Poll | null> {
  const key = process.env.KENPOM_API_KEY?.trim();
  if (!key) return null;
  const url = new URL(KENPOM_API);
  url.searchParams.set("endpoint", "ratings");
  url.searchParams.set("y", String(season));
  return normalizeKenpom(await fetchJson(url.toString(), { Authorization: `Bearer ${key}` }), season);
}

/* ---------- Futures ---------- */

export type FutureCategory = "championship" | "tournament" | "conference" | "award";

export interface FutureOutcome { name: string; teamId: string | null; athleteId: string | null; american: number }
export interface FutureMarket {
  id: string;
  name: string;
  category: FutureCategory;
  conference: string | null;
  /** Sportsbook key in the odds catalog. */
  book: string;
  bookName: string;
  outcomes: FutureOutcome[];
}

const refId = (value: unknown, kind: "teams" | "athletes") => new RegExp(`/${kind}/(\\d+)`).exec(str(obj(value).$ref))?.[1] ?? null;

export function parseFutureName(name: string): { label: string; category: FutureCategory; conference: string | null } {
  const text = name.replace(/^NCAA\([A-Z]\)\s*-\s*/i, "").trim();
  const conference = /^(.+?)\s*-\s*Winner/i.exec(text)?.[1]?.trim() ?? null;
  if (conference) return { label: `${conference} regular-season champion`, category: "conference", conference };
  if (/^winner$/i.test(text)) return { label: "National champion", category: "championship", conference: null };
  if (/final 4|final four|elite 8|sweet 16|tournament/i.test(text)) return { label: text, category: "tournament", conference: null };
  return { label: text, category: "award", conference: null };
}

export function normalizeFutures(payload: unknown, names: { team: (id: string) => string | null }): FutureMarket[] {
  const markets: FutureMarket[] = [];
  for (const item of arr(obj(payload).items).map(obj)) {
    const parsed = parseFutureName(str(item.name));
    for (const future of arr(item.futures).map(obj)) {
      const provider = str(obj(future.provider).name);
      const outcomes = arr(future.books).map(obj).map((book): FutureOutcome | null => {
        const teamId = refId(book.team, "teams");
        const athleteId = refId(book.athlete, "athletes");
        const text = str(book.value).toUpperCase();
        const american = text === "EVEN" ? 100 : Number(text.replace(/^\+/, ""));
        const name = teamId ? names.team(teamId) : null;
        // Player awards need a name lookup per athlete; only team markets are offered for now.
        if (!name || !Number.isFinite(american) || Math.abs(american) < 100) return null;
        return { name, teamId, athleteId, american };
      }).filter((outcome): outcome is FutureOutcome => outcome !== null).sort((a, b) => a.american - b.american);
      if (outcomes.length < 2 || !provider) continue;
      markets.push({ id: str(item.id), name: parsed.label, category: parsed.category, conference: parsed.conference, book: provider.toLowerCase().replace(/[^a-z]/g, ""), bookName: provider, outcomes });
    }
  }
  const order: FutureCategory[] = ["championship", "tournament", "conference", "award"];
  return markets.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name));
}

export async function fetchFutures(season: number, names: { team: (id: string) => string | null }): Promise<FutureMarket[]> {
  return normalizeFutures(await fetchJson(`${CORE_API}/v2/sports/${CORE_PATH}/seasons/${season}/futures?limit=200`), names);
}

/* ---------- Closing lines (ATS and over/under records) ---------- */

export interface ClosingLine { homeSpread: number | null; total: number | null; provider: string }

export function normalizeClosingLine(payload: unknown): ClosingLine | null {
  const item = arr(obj(payload).items).map(obj).find((entry) => toNumber(entry.spread) !== null || toNumber(entry.overUnder) !== null);
  if (!item) return null;
  // ESPN's `spread` is the home team's line (negative when the home team is favored).
  const closeSpread = toNumber(obj(obj(obj(item.homeTeamOdds).close).pointSpread).american);
  return { homeSpread: closeSpread ?? toNumber(item.spread), total: toNumber(item.overUnder), provider: str(obj(item.provider).name) || "DraftKings" };
}

export async function fetchClosingLine(eventId: string): Promise<ClosingLine | null> {
  const id = encodeURIComponent(eventId);
  return normalizeClosingLine(await fetchJson(`${CORE_API}/v2/sports/${CORE_PATH}/events/${id}/competitions/${id}/odds`));
}
