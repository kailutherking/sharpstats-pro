export interface User {
  id: number;
  username: string;
  email: string;
  created_at?: string;
}

export type BetResult = "pending" | "win" | "loss" | "push";

export interface Bet {
  id: number;
  sport: string;
  league: string;
  event: string;
  bet_type: string;
  team_player: string;
  odds: number | string;
  stake: number | string;
  result: BetResult;
  profit_loss: number | string;
  sportsbook: string;
  bet_date: string;
  closing_odds?: number | string | null;
  market_key?: string;
  selection?: string;
  line_value?: number | string | null;
  event_id?: string | null;
  notes?: string;
}

export interface Summary {
  daily_pl: string;
  weekly_pl: string;
  monthly_pl: string;
  total_pl: string;
  settled_stake: string;
  wins: string;
  decisions: string;
  active_bets: string;
  average_odds: string;
  clv_pct: string;
  risk_exposure: string;
  roi: number;
  win_rate: number;
  bankroll: { starting_bankroll: string; current_bankroll: string; unit_size: string };
}

export interface Performance {
  bySport: GroupMetric[];
  byBook: GroupMetric[];
  byType: GroupMetric[];
  byLeague: GroupMetric[];
  monthly: { month: string; profit_loss: string }[];
  daily: { day: string; profit_loss: string }[];
}

export interface GroupMetric {
  name: string;
  decisions: string;
  wins: string;
  profit_loss: string;
}

export interface Bankroll {
  starting_bankroll: string;
  current_bankroll: string;
  unit_size: string;
}

export interface ResearchQuote {
  sport: string;
  event: string;
  eventId: string;
  commenceTime: string;
  sportsbook: string;
  market: string;
  point?: number;
  outcome: string;
  decimalOdds: number;
  impliedProbability: number;
  fairProbability: number | null;
  bookCount: number;
  expectedValue: number | null;
  calibratedProbability: number | null;
  modelStatus: "trained" | "insufficient_history";
  previousOdds: number | null;
  movement: number | null;
}

export interface ResearchData {
  source: string;
  sport: string;
  includeProps: boolean;
  lineCount: number;
  quotes: ResearchQuote[];
  lines: ResearchQuote[];
  arbitrage: {
    event: string;
    market: string;
    point: number | null;
    overround: number;
    legs: { outcome: string; sportsbook: string; odds: number; stakeFraction: number }[];
  }[];
  model: {
    algorithm: string;
    status: "trained" | "insufficient_history";
    sampleSize: number;
    minimumSampleSize: number;
    brierScore: number | null;
  };
}

export interface OddsMovement {
  event_id: string;
  sport: string;
  event: string;
  market: string;
  point: string | null;
  outcome: string;
  sportsbook: string;
  opening_odds: string;
  high_odds: string;
  latest_odds: string;
  observations: string;
}
