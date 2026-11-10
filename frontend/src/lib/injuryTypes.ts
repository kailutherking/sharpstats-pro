import type { League } from "./statsTypes";

export const INJURY_STATUSES = ["Out", "Doubtful", "Questionable", "Game Time Decision", "Probable", "Day-to-Day", "Injured Reserve", "Suspended", "Inactive", "Active"] as const;
export type InjuryStatus = typeof INJURY_STATUSES[number];
export type ImpactTier = "Elite" | "High" | "Moderate" | "Low" | "Minimal";
export type ImpactLevel = "Very High" | "High" | "Moderate" | "Low" | "None";

export interface InjuryImpact {
  importance: number; tier: ImpactTier; statusWeight: number; projectedImpact: number; ratingChange: number; expectedRatingChange: number; ratingUnit: string; winImpact: number;
  offensive: { change: number; level: ImpactLevel }; defensive: { change: number; level: ImpactLevel };
  fantasy: { perGame: number | null; percentile: number | null; level: ImpactLevel };
  prop: { level: ImpactLevel; markets: string[]; beneficiaries: Array<{ id: string; name: string; position: string; stat: string; value: number }> };
  basis: string; hasStats: boolean;
}

export interface InjuryRow {
  id: string; league: League; athleteId: string; name: string; headshot: string | null; position: string; positionName: string; teamId: string; teamAbbr: string; teamName: string;
  teamNickname: string; teamLogo: string | null; status: InjuryStatus; providerStatus: string; injuryType: string | null; location: string | null; detail: string | null; side: string | null;
  returnDate: string | null; shortComment: string; longComment: string; reportedAt: string; source: string; injury: string; firstReportedAt: string; impact: InjuryImpact;
}

export interface TeamHealth {
  teamId: string; teamName: string; teamAbbr: string; logo: string | null; score: number; label: "Healthy" | "Minor concerns" | "Banged up" | "Depleted";
  active: number; out: number; questionable: number; returning: number; suspended: number; keyOut: string[];
}

export interface InjuryReport {
  league: League; injuries: InjuryRow[]; total: number; counts: Record<InjuryStatus, number>; teams: TeamHealth[];
  filters: { teams: Array<{ id: string; name: string; abbr: string }>; positions: string[]; statuses: InjuryStatus[] };
  fetchedAt: string; refreshMinutes: number; source: string; stale: boolean;
}

export interface LineImpact {
  gameId: string; game: string; commenceTime: string; team: string; market: "spreads";
  before: { point: number; american: number; at: string } | null; current: { point: number; american: number; at: string } | null;
  move: number | null; direction: "against" | "toward" | "none" | null; baseline: "report" | "tracking_start" | null;
  affectedBooks: Array<{ book: string; name: string; before: number; current: number; delta: number }>; message: string;
}

export interface PlayerInjuryProfile {
  league: League; injury: InjuryRow | null; dateInjured: string | null;
  timeline: Array<{ status: string; previousStatus: string | null; injury: string | null; returnDate: string | null; comment: string | null; reportedAt: string; recordedAt: string }>;
  pastInjuries: Array<{ injury: string; firstSeen: string; lastSeen: string; statuses: string[] }>;
  news: Array<{ headline: string; story: string | null; published: string | null; source: string }>;
  practice: Array<{ level: "Full" | "Limited" | "Did not practice"; note: string; at: string }>;
  workload: string[]; line: LineImpact | null; historyNote: string; fetchedAt: string; source: string;
}

export interface TeamInjuries { league: League; team: TeamHealth; injuries: InjuryRow[]; line: LineImpact | null; trend: Array<{ score: number; at: string }>; fetchedAt: string }

export interface InjuryImpactList { league: League; impacts: Array<{ injury: InjuryRow; line: LineImpact | null }>; fetchedAt: string; source: string }

export interface InjuryQuery { league: League; team?: string; position?: string; status?: InjuryStatus[]; updated?: "24h" | "3d" | "7d" | "all"; q?: string; refresh?: boolean }
