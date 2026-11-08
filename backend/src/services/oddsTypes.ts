import type { OddsSport } from "./oddsCatalog";

export type GameStatus = "pregame" | "live" | "final";
export type OddsSource = "the-odds-api" | "espn";

export interface OddsGame {
  id: string;
  sport: OddsSport;
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string | null;
  awayAbbr: string | null;
  homeLogo: string | null;
  awayLogo: string | null;
  commenceTime: string;
  status: GameStatus;
  provider: OddsSource;
}

/** One price at one sportsbook, as returned by a provider. */
export interface RawQuote {
  gameId: string;
  sport: OddsSport;
  market: string;
  book: string;
  /** Outcome name: a team, "Over", "Under", "Yes" or "No". */
  selection: string;
  /** Player for props, team for team totals, "" otherwise. */
  participant: string;
  point: number | null;
  american: number;
  decimal: number;
  bookUpdatedAt: string | null;
  /** Opening price reported by the provider itself (ESPN publishes DraftKings openers). */
  providerOpen?: { american: number; point: number | null };
}

export interface ProviderUsage {
  remaining: number | null;
  used: number | null;
  lastCost: number | null;
  updatedAt: string | null;
}

export interface ProviderBoard {
  source: OddsSource;
  games: OddsGame[];
  quotes: RawQuote[];
}
