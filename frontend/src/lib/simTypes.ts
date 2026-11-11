import type { OddsSport } from "./oddsTypes";
import type { ColumnMeta, TeamRow } from "./statsTypes";

/** Simulated betting: nothing here is a real-money wager. */
export type SlipMode = "single" | "parlay";
export type WagerStatus = "open" | "won" | "lost" | "push" | "void";

/** A selection waiting on the bet slip. `key` identifies it for add/remove. */
export interface SlipLeg {
  key: string;
  kind: "market" | "future";
  sport: OddsSport;
  /** Market legs. */
  gameId?: string;
  selectionId?: string;
  book: string;
  /** Future legs. */
  marketId?: string;
  outcome?: string;
  american: number;
  label: string;
  event: string;
  bookName: string;
  stake: string;
}

export interface BankrollOverview {
  startingBankroll: number;
  currentBankroll: number;
  unitSize: number;
  exposure: number;
  available: number;
  pendingBets: number;
  potentialPayout: number;
  riskPct: number;
  exposureUnits: number;
}

export interface PricedLeg {
  index: number; sport: OddsSport; gameId: string; event: string; commenceTime: string | null; marketLabel: string; label: string; conference: string;
  book: string; bookName: string; american: number; decimal: number; fairProbability: number | null; requestedAmerican: number; changed: boolean; live: boolean;
}
export interface PricedWager {
  betType: string; description: string; bookName: string; stake: number; decimal: number; american: number; payout: number; profit: number;
  fairProbability: number | null; evPct: number | null; units: number; riskPct: number; legs: PricedLeg[];
}
export interface SlipQuote {
  mode: SlipMode; slipType: "single" | "parlay" | "sgp"; wagers: PricedWager[]; totalStake: number; totalPayout: number; bankroll: BankrollOverview;
  availableAfter: number; oddsChanged: boolean; problems: string[]; notes: string[];
}
export interface SlipRequest {
  mode: SlipMode;
  stake?: number;
  acceptOddsChanges?: boolean;
  legs: Array<{ kind: "market"; sport: OddsSport; gameId: string; selectionId: string; book: string; american: number; stake?: number } | { kind: "future"; marketId: string; outcome: string; american: number; stake?: number }>;
}

export interface WagerLeg {
  id: string; sport: string; event: string; commenceTime: string | null; label: string; conference: string; book: string; oddsAmerican: number;
  closingAmerican: number | null; status: WagerStatus; resultValue: number | null; resultNote: string;
}
export interface Wager {
  id: string; betId: number; betType: string; betTypeLabel: string; sport: string; conference: string; sportsbook: string; description: string; stake: number;
  oddsDecimal: number; oddsAmerican: number; potentialPayout: number; status: WagerStatus; payout: number; profitLoss: number; units: number; riskPct: number;
  evPct: number | null; clvPct: number | null; placedAt: string; settledAt: string | null; startsAt: string | null; canVoid: boolean; canSettle: boolean; legs: WagerLeg[];
}
export interface GradeResult { checked: number; legsGraded: number; settled: number; won: number; lost: number; refunded: number }

export interface BankrollTransaction { id: string; kind: "stake" | "payout" | "refund" | "adjustment"; amount: number; balanceAfter: number; wagerId: string | null; note: string; createdAt: string }
export interface BankrollHistory {
  bankroll: BankrollOverview;
  transactions: BankrollTransaction[];
  curve: Array<{ date: string; profitLoss: number; bankroll: number; bets: number }>;
}

export interface SimGroup { label: string; bets: number; wins: number; losses: number; staked: number; profitLoss: number; roi: number; winRate: number; units: number; avgClv: number | null; avgEv: number | null }
export interface SimAnalytics {
  bankroll: BankrollOverview;
  totals: SimGroup;
  bySport: SimGroup[];
  byConference: SimGroup[];
  byBetType: SimGroup[];
  byBook: SimGroup[];
  ncaa: { markets: SimGroup[]; sides: SimGroup[]; conferences: SimGroup[]; totals: SimGroup | null };
  profitCurve: Array<{ date: string; profitLoss: number; cumulative: number; staked: number; bets: number }>;
}

/* ---------- NCAA ---------- */

export type PollKey = "ap" | "coaches" | "net" | "kenpom";
export interface RankedTeam {
  rank: number; previousRank: number | null; teamId: string | null; team: string; abbr: string; logo: string | null; record: string; points: number | null;
  firstPlaceVotes: number | null; trend: string; extra: Record<string, string | number | null>;
}
export interface Poll { key: PollKey; name: string; release: string; season: number | null; updatedAt: string | null; source: string; teams: RankedTeam[]; others: RankedTeam[] }
export interface NcaaRankings { polls: Poll[]; unavailable: Array<{ key: PollKey; name: string; reason: string }>; fetchedAt: string; stale: boolean }

export type NcaaTeam = TeamRow & { conferenceRecord: string; ranks: Partial<Record<PollKey, number>> };
export interface ConferenceStanding { conference: string; abbr: string; teams: Array<Pick<NcaaTeam, "id" | "name" | "shortName" | "abbr" | "logo" | "record" | "conferenceRecord" | "home" | "away" | "streak" | "winPct" | "ranks">> }
export interface NcaaStats { conferences: string[]; teamColumns: ColumnMeta[]; teams: NcaaTeam[]; standings: ConferenceStanding[]; playerCount: number; source: string; fetchedAt: string }

export interface FutureMarket { id: string; name: string; category: "championship" | "tournament" | "conference" | "award"; conference: string | null; book: string; bookName: string; outcomes: Array<{ name: string; teamId: string | null; american: number }> }
export interface NcaaFutures { season: { year: number; displayName: string }; source: string; fetchedAt: string; markets: FutureMarket[] }

export interface TeamTrends {
  ats: { record: string; games: number };
  overUnder: { record: string; games: number };
  last5: { record: string; form: string };
  last10: { record: string; form: string };
  strengthOfSchedule: { opponentWinPct: number | null; opponents: number; rank: number | null; source: string };
  gamesWithLines: number;
  note: string;
}
