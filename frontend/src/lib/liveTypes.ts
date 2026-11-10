import type { League } from "./statsTypes";

export type LiveStatus = "pregame" | "live" | "halftime" | "end_period" | "final" | "delayed" | "postponed";

export interface LiveTeam {
  id: string; name: string; shortName: string; abbr: string; logo: string | null; score: number | null; record: string | null;
  linescores: Array<number | null>; winner: boolean; timeouts: number | null; fouls: number | null; inBonus: boolean | null; shots: number | null;
}

export interface SituationPlayer { id: string; name: string; summary: string | null; headshot: string | null }

export interface LiveSituation {
  possessionTeamId: string | null; lastPlay: string | null;
  down: number | null; distance: number | null; yardLine: number | null; downDistance: string | null; possessionText: string | null; isRedZone: boolean;
  balls: number | null; strikes: number | null; outs: number | null; onFirst: boolean; onSecond: boolean; onThird: boolean;
  pitcher: SituationPlayer | null; batter: SituationPlayer | null;
  powerPlay: { teamId: string; strength: string; timeRemaining: string | null } | null; penalties: string[];
}

export interface DkLine {
  provider: string;
  spread: { home: { line: number | null; odds: number | null }; away: { line: number | null; odds: number | null } } | null;
  total: { line: number | null; over: number | null; under: number | null } | null;
  moneyline: { home: number | null; away: number | null } | null;
}

export interface LiveLineSummary {
  source: "multi-book" | "espn" | null; books: number; updatedAt: string | null;
  moneyline: { home: number | null; away: number | null; homeBook: string | null; awayBook: string | null } | null;
  spread: { homeLine: number | null; homeOdds: number | null; awayLine: number | null; awayOdds: number | null } | null;
  total: { line: number | null; over: number | null; under: number | null } | null;
  marketHomeProbability: number | null;
}

export interface LiveGame {
  id: string; league: League; name: string; shortName: string; startTime: string; status: LiveStatus; statusDetail: string; statusLabel: string;
  clock: string | null; period: number; periodLabel: string | null; home: LiveTeam; away: LiveTeam; situation: LiveSituation; venue: string | null; broadcast: string | null;
  homeWinProbability: number | null; espnOdds: { current: DkLine | null; open: DkLine | null };
  oddsGameId: string | null; lines: LiveLineSummary; winProbability: { home: number; away: number; source: string } | null;
}

export interface LiveGamesResponse {
  league: League; games: LiveGame[]; counts: { live: number; pregame: number; final: number }; fetchedAt: string; oddsUpdatedAt: string | null;
  refreshSeconds: number; source: string; stale: boolean;
}

export interface BoxPlayer { id: string; name: string; shortName: string; position: string; headshot: string | null; starter: boolean; active: boolean; didNotPlay: boolean; display: Record<string, string>; values: Record<string, number | null> }
export interface BoxGroup { key: string; label: string; labels: string[]; keys: string[]; players: BoxPlayer[]; totals: string[] }
export interface BoxTeam { teamId: string; groups: BoxGroup[] }
export interface TeamStatLine { key: string; label: string; home: string; away: string }
export interface LeaderLine { category: string; label: string; teamId: string; playerId: string; name: string; headshot: string | null; value: string }
export interface PlayText { id: string; text: string; clock: string | null; period: number | null; scoring: boolean; teamId: string | null; type: string | null }

export interface BookQuote {
  book: string; name: string; american: number; point: number | null; open: { american: number; point: number | null } | null;
  close: { american: number; point: number | null } | null; moveFromOpen: number | null; updatedAt: string | null;
}
export interface MarketSide { selectionId: string; label: string; selection: string; point: number | null; best: { book: string; american: number } | null; fairProbability: number | null; books: BookQuote[] }
export interface MarketView { key: string; label: string; category: string; sides: MarketSide[] }
export interface BookCoverage { key: string; name: string; kind: string; status: "priced" | "props_only" | "no_prices"; prices: number }

export interface LiveOddsPanelData {
  oddsGameId: string | null; source: "multi-book" | "espn" | null; updatedAt: string | null; markets: MarketView[]; periodMarkets: MarketView[];
  props: number; coverage: BookCoverage[]; espn: { current: DkLine | null; open: DkLine | null }; closingCaptured: boolean;
}

export interface LiveGameDetail {
  league: League; game: LiveGame; teamStats: TeamStatLine[]; box: BoxTeam[]; leaders: LeaderLine[]; plays: PlayText[];
  winProbability: Array<{ home: number }>; odds: LiveOddsPanelData; fetchedAt: string; refreshSeconds: number; source: string; stale: boolean;
}

export interface PlayerPropTrack {
  key: string; label: string; current: number | null; seasonAverage: number | null; projected: number | null; pace: number | null;
  line: number | null; lineSource: string | null; overPrice: number | null; underPrice: number | null; hitProbability: number | null;
  overProgress: number | null; underCushion: number | null; needed: number | null;
}

export interface LivePlayer {
  league: League; gameId: string;
  player: { id: string; name: string; position: string; headshot: string | null; teamId: string; teamAbbr: string; starter: boolean };
  game: { id: string; shortName: string; status: LiveStatus; statusLabel: string; clock: string | null; periodLabel: string | null };
  progress: number; stats: Array<{ group: string; label: string; display: Record<string, string> }>; props: PlayerPropTrack[]; propsLoaded: boolean; fetchedAt: string;
}

export const inProgress = (status: LiveStatus) => status === "live" || status === "halftime" || status === "end_period" || status === "delayed";
