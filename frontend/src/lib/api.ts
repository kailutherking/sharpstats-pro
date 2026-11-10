import type {
  Bankroll,
  Bet,
  OddsMovement,
  Performance,
  ResearchData,
  Summary,
  User,
} from "./types";
import type { FavoriteInput, FavoriteStat, League, LeagueStats, PlayerProfile, StatsWindow, TeamProfile } from "./statsTypes";
import type {
  AlertRule, AlertRuleInput, AlertType, ArbitrageData, BoardQuery, ClvData, EvData, GameDetail, HistoryData, MovementData, OddsAlert,
  OddsBoard, OddsFavorite, OddsSport, PropsData, SearchResult, SportsbookRow,
} from "./oddsTypes";
import type { LiveGameDetail, LiveGamesResponse, LivePlayer } from "./liveTypes";
import type { InjuryImpactList, InjuryQuery, InjuryReport, PlayerInjuryProfile, TeamInjuries } from "./injuryTypes";

const API_URL = (
  import.meta.env.VITE_API_URL ||
  `http://${window.location.hostname}:4000/api`
).replace(/\/+$/, "");

console.log("API URL:", API_URL);

const TOKEN_KEY = "sharpstats_token";

async function fetchApi(path: string, options: RequestInit): Promise<Response> {
  try {
    const response = await fetch(`${API_URL}${path}`, options);
    if (!response.ok) {
      console.error("API Error", { path, status: response.status, apiUrl: API_URL });
    }
    return response;
  } catch (error) {
    console.error("API Error", { path, status: 0, apiUrl: API_URL });
    throw error;
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event("sharpstats:unauthorized"));
  },
};

let refreshRequest: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshRequest) {
    refreshRequest = fetchApi("/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    }).then(async (response) => {
      if (!response.ok) return null;
      const payload = await response.json() as { token: string };
      tokenStore.set(payload.token);
      return payload.token;
    }).catch(() => null).finally(() => {
      refreshRequest = null;
    });
  }
  return refreshRequest;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const token = tokenStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const options: RequestInit = { ...init, headers, credentials: "include" };
  let response = await fetchApi(path, options);
  const isPublicAuthRoute = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"].includes(path);
  if (response.status === 401 && !isPublicAuthRoute) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers.set("Authorization", `Bearer ${refreshed}`);
      response = await fetchApi(path, options);
    }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" })) as { error?: string };
    if (response.status === 401) tokenStore.clear();
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function download(path: string): Promise<Blob> {
  const headers = new Headers();
  const token = tokenStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const options: RequestInit = { headers, credentials: "include" };
  let response = await fetchApi(path, options);
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers.set("Authorization", `Bearer ${refreshed}`);
      response = await fetchApi(path, options);
    }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Download failed" })) as { error?: string };
    if (response.status === 401) tokenStore.clear();
    throw new Error(body.error ?? `Download failed (${response.status})`);
  }
  return response.blob();
}

/** Opens an authenticated streaming response (Server-Sent Events over fetch, so the bearer token can be sent). */
async function stream(path: string, signal: AbortSignal): Promise<Response> {
  const headers = new Headers({ Accept: "text/event-stream" });
  const token = tokenStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const options: RequestInit = { headers, credentials: "include", signal };
  let response = await fetch(`${API_URL}${path}`, options);
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers.set("Authorization", `Bearer ${refreshed}`);
      response = await fetch(`${API_URL}${path}`, options);
    }
  }
  if (!response.ok || !response.body) throw new Error(`Stream failed (${response.status})`);
  return response;
}

function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

const tzOffset = () => new Date().getTimezoneOffset();

export const api = {
  login: (email: string, password: string) => request<{ token: string; user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (username: string, email: string, password: string) => request<{ token: string; user: User }>("/auth/register", { method: "POST", body: JSON.stringify({ username, email, password }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: User }>("/auth/me"),
  bets: (search = "") => request<{ bets: Bet[] }>(`/bets${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  createBet: (bet: Partial<Bet>) => request<{ bet: Bet }>("/bets", { method: "POST", body: JSON.stringify(bet) }),
  updateBet: (id: number, patch: Partial<Bet>) => request<{ bet: Bet }>(`/bets/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteBet: (id: number) => request<void>(`/bets/${id}`, { method: "DELETE" }),
  summary: () => request<Summary>("/analytics/summary"),
  performance: () => request<Performance>("/analytics/performance"),
  bankroll: () => request<{ bankroll: Bankroll }>("/bankroll"),
  saveBankroll: (data: Pick<Bankroll, "starting_bankroll" | "unit_size">) => request<{ bankroll: Bankroll }>("/bankroll", { method: "PUT", body: JSON.stringify(data) }),
  profile: () => request<{ user: User }>("/profile"),
  saveProfile: (username: string) => request<{ user: User }>("/profile", { method: "PUT", body: JSON.stringify({ username }) }),
  sportsbooks: () => request<{ sportsbooks: { id: number; name: string; region: string; favorite: boolean }[] }>("/sportsbooks"),
  favorite: (id: number, favorite: boolean) => request<{ favorite: boolean }>(`/sportsbooks/${id}/favorite`, { method: "PUT", body: JSON.stringify({ favorite }) }),
  marketScan: (sport = "basketball_nba", includeProps = false) => request<ResearchData>(`/odds/scan?sport=${encodeURIComponent(sport)}&includeProps=${includeProps}`),
  marketSnapshots: () => request<{ movements: OddsMovement[] }>("/odds/snapshots"),
  oddsModel: () => request<{ algorithm: string; status: string; sampleSize: number; minimumSampleSize: number; brierScore: number | null; message: string }>("/odds/model"),
  oddsRisk: () => request<{ bankroll: Bankroll; openStake: number; exposurePercent: number; portfolioRiskLimit: number; availableRiskBudget: number; unitCap: number }>("/odds/risk"),
  gradeBets: () => request<{ graded: number; pending: number; skipped: number; message?: string; providerErrors?: string[] }>("/bets/grade", { method: "POST" }),
  importBets: (rows: Record<string, string>[]) => request<{ imported: number; skipped: number; errors: { row: number; message: string }[] }>("/bets/import", { method: "POST", body: JSON.stringify({ rows }) }),
  exportUrl: `${API_URL}/bets/export`,
  report: (format: "xlsx" | "pdf") => `${API_URL}/bets/report/${format}`,
  download: (path: string) => download(path),
  stats: (league: League, window: StatsWindow = "season") => request<LeagueStats>(`/stats/${league}?window=${window}`),
  refreshStats: (league: League, window: StatsWindow = "season") => request<LeagueStats>(`/stats/${league}/refresh?window=${window}`, { method: "POST" }),
  statsPlayer: (league: League, id: string, window: StatsWindow = "season", refresh = false) =>
    request<PlayerProfile>(`/stats/player/${encodeURIComponent(id)}?league=${league}&window=${window}${refresh ? "&refresh=true" : ""}`),
  statsTeam: (league: League, id: string, refresh = false) =>
    request<TeamProfile>(`/stats/team/${encodeURIComponent(id)}?league=${league}${refresh ? "&refresh=true" : ""}`),
  statsFavorites: () => request<{ favorites: FavoriteStat[] }>("/stats/favorites"),
  setStatsFavorite: (favorite: FavoriteInput) => request<{ favorite: boolean }>("/stats/favorites", { method: "PUT", body: JSON.stringify(favorite) }),
  oddsBoard: (params: BoardQuery) => request<OddsBoard>(`/odds${query({ ...params, tzOffset: params.date ? tzOffset() : undefined })}`),
  oddsRefresh: (sport: OddsSport) => request<OddsBoard>(`/odds/refresh${query({ sport })}`, { method: "POST" }),
  oddsLive: (sport: OddsSport) => request<OddsBoard>(`/odds/live${query({ sport })}`),
  oddsGame: (sport: OddsSport, id: string, props = false) => request<GameDetail>(`/odds/game/${encodeURIComponent(id)}${query({ sport, props })}`),
  oddsMovement: (sport: OddsSport, gameId?: string, hours = 24) => request<MovementData>(`/odds/movement${query({ sport, gameId, hours })}`),
  oddsHistory: (sport: OddsSport, sideId: string, book?: string) => request<HistoryData>(`/odds/history${query({ sport, sideId, book })}`),
  oddsEv: (sport: OddsSport, minEv = 0.005, market?: string, book?: string) => request<EvData>(`/odds/ev${query({ sport, minEv, market, book })}`),
  oddsArbitrage: (sport: OddsSport, total = 100) => request<ArbitrageData>(`/odds/arbitrage${query({ sport, total })}`),
  oddsProps: (params: { sport: OddsSport; gameId?: string; market?: string; player?: string; team?: string; book?: string; date?: string; type?: "ou" | "yes" }) =>
    request<PropsData>(`/odds/player-props${query({ ...params, tzOffset: params.date ? tzOffset() : undefined })}`),
  oddsSportsbooks: () => request<{ mode: string; sportsbooks: SportsbookRow[] }>("/odds/sportsbooks"),
  oddsSearch: (q: string) => request<{ results: SearchResult[] }>(`/odds/search${query({ q })}`),
  oddsAlerts: (params: { sport?: OddsSport; types?: AlertType[]; mine?: boolean; hours?: number }) =>
    request<{ alerts: OddsAlert[]; rules: AlertRule[] }>(`/odds/alerts${query({ sport: params.sport, types: params.types?.join(","), mine: params.mine, hours: params.hours })}`),
  createAlertRule: (rule: AlertRuleInput) => request<{ rule: AlertRule }>("/odds/alerts/rules", { method: "POST", body: JSON.stringify(rule) }),
  updateAlertRule: (id: number, active: boolean) => request<{ rule: AlertRule }>(`/odds/alerts/rules/${id}`, { method: "PATCH", body: JSON.stringify({ active }) }),
  deleteAlertRule: (id: number) => request<void>(`/odds/alerts/rules/${id}`, { method: "DELETE" }),
  oddsFavorites: () => request<{ favorites: OddsFavorite[] }>("/odds/favorites"),
  setOddsFavorite: (favorite: OddsFavorite, enabled: boolean) => request<{ favorite: boolean }>("/odds/favorites", { method: "PUT", body: JSON.stringify({ ...favorite, favorite: enabled }) }),
  oddsClv: () => request<ClvData>("/odds/clv"),
  oddsStream: (sport: OddsSport, signal: AbortSignal) => stream(`/odds/stream${query({ sport })}`, signal),
  liveGames: (league: League, refresh = false) => request<LiveGamesResponse>(`/live-games${query({ league, refresh })}`),
  liveGame: (league: League, id: string, refresh = false) => request<LiveGameDetail>(`/live-games/${encodeURIComponent(id)}${query({ league, refresh })}`),
  livePlayer: (league: League, gameId: string, playerId: string, stat?: string, line?: number) =>
    request<LivePlayer>(`/live-games/player/${encodeURIComponent(playerId)}${query({ league, gameId, stat, line })}`),
  injuries: (params: InjuryQuery) => request<InjuryReport>(`/injuries${query({ ...params, status: params.status?.join(","), updated: params.updated === "all" ? undefined : params.updated })}`),
  injuryPlayer: (league: League, id: string) => request<PlayerInjuryProfile>(`/injuries/player/${encodeURIComponent(id)}${query({ league })}`),
  injuryTeam: (league: League, id: string) => request<TeamInjuries>(`/injuries/team/${encodeURIComponent(id)}${query({ league })}`),
  injuryImpact: (league: League, min?: number, limit?: number) => request<InjuryImpactList>(`/injuries/impact${query({ league, min, limit })}`),
};