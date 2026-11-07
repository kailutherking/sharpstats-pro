import type { Bankroll, Bet, OddsMovement, Performance, ResearchData, Summary, User } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
const TOKEN_KEY = "sharpstats_token";

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
    refreshRequest = fetch(`${API_URL}/auth/refresh`, {
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
  let response = await fetch(`${API_URL}${path}`, options);
  const isPublicAuthRoute = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"].includes(path);
  if (response.status === 401 && !isPublicAuthRoute) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers.set("Authorization", `Bearer ${refreshed}`);
      response = await fetch(`${API_URL}${path}`, options);
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
  let response = await fetch(`${API_URL}${path}`, options);
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers.set("Authorization", `Bearer ${refreshed}`);
      response = await fetch(`${API_URL}${path}`, options);
    }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Download failed" })) as { error?: string };
    if (response.status === 401) tokenStore.clear();
    throw new Error(body.error ?? `Download failed (${response.status})`);
  }
  return response.blob();
}

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
  odds: (sport = "basketball_nba", includeProps = false) => request<ResearchData>(`/odds?sport=${encodeURIComponent(sport)}&includeProps=${includeProps}`),
  oddsMovement: () => request<{ movements: OddsMovement[] }>("/odds/movement"),
  oddsModel: () => request<{ algorithm: string; status: string; sampleSize: number; minimumSampleSize: number; brierScore: number | null; message: string }>("/odds/model"),
  oddsRisk: () => request<{ bankroll: Bankroll; openStake: number; exposurePercent: number; portfolioRiskLimit: number; availableRiskBudget: number; unitCap: number }>("/odds/risk"),
  gradeBets: () => request<{ graded: number; pending: number; skipped: number; message?: string; providerErrors?: string[] }>("/bets/grade", { method: "POST" }),
  importBets: (rows: Record<string, string>[]) => request<{ imported: number; skipped: number; errors: { row: number; message: string }[] }>("/bets/import", { method: "POST", body: JSON.stringify({ rows }) }),
  exportUrl: `${API_URL}/bets/export`,
  report: (format: "xlsx" | "pdf") => `${API_URL}/bets/report/${format}`,
  download: (path: string) => download(path),
};
