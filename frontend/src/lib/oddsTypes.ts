export type OddsSport = "nba" | "nfl" | "mlb" | "nhl";
export type MarketCategory = "game" | "period" | "team" | "alternate" | "prop";
export type MarketType = "moneyline" | "spread" | "total" | "team_total" | "prop_ou" | "prop_yes";
export type EvTier = "positive" | "strong" | "elite";
export type RiskRating = "low" | "medium" | "high";
export type GameStatus = "pregame" | "live" | "final";

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
  provider: "the-odds-api" | "espn";
  label: string;
}

/** reverse = estimated reverse line movement (line moved toward the underdog or under). */
export interface SideSignals { steam: boolean; sharp: boolean; reverse: boolean; moves: number; lastMoveAt: string | null }

export interface Confidence { score: number; label: "high" | "medium" | "low"; reasons: string[] }

export interface BookPrice {
  book: string;
  american: number;
  decimal: number;
  point: number | null;
  implied: number;
  atLine: boolean;
  priced: boolean;
  bookUpdatedAt: string | null;
  lastSeenAt: string;
  open: { american: number; point: number | null; at: string } | null;
  previous: { american: number; point: number | null } | null;
  high: number | null;
  low: number | null;
  highPoint: number | null;
  lowPoint: number | null;
  lastChangeAt: string | null;
  probabilityMove: number | null;
  pointMove: number | null;
  isBest: boolean;
  ev: number | null;
  kelly: number | null;
}

export interface FairValue { probability: number; american: number | null; source: "sharp" | "consensus"; sourceLabel: string; books: number }

export interface Selection {
  id: string;
  pairId: string;
  gameId: string;
  sport: OddsSport;
  market: string;
  marketLabel: string;
  category: MarketCategory;
  type: MarketType;
  period: string;
  selection: string;
  participant: string;
  point: number | null;
  label: string;
  books: BookPrice[];
  best: { book: string; american: number; decimal: number } | null;
  worst: { book: string; american: number; decimal: number } | null;
  average: { american: number | null; implied: number } | null;
  fair: FairValue | null;
  ev: number | null;
  edge: number | null;
  kelly: number | null;
  tier: EvTier | null;
  risk: RiskRating | null;
  confidence: Confidence | null;
  arbitrage: number | null;
  signals: SideSignals;
  updatedAt: string;
}

export interface ProviderStatus {
  mode: "the-odds-api" | "espn";
  label: string;
  configured: boolean;
  connected: boolean;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  nextRefreshAt: string | null;
  refreshSeconds: number;
  throttled: boolean;
  credits: { remaining: number | null; used: number | null; lastCost: number | null; updatedAt: string | null } | null;
  unsupportedMarkets: string[];
  streamClients: number;
  notes: string[];
  provider: "auto" | "theoddsapi" | "espn";
  warning: string | null;
}

export interface BookInfo {
  key: string;
  name: string;
  kind: "sportsbook" | "dfs" | "reference";
  retired: string | null;
  prices: number;
  status: "connected" | "no_markets" | "requires_api_key" | "retired";
}

export interface MarketInfo { key: string; label: string; short: string; category: MarketCategory; type: MarketType; selections: number; available: boolean }

export interface Sizing { bankroll: number; kellyMultiplier: number; maxStakeFraction: number }

export interface BoardMetrics {
  bestAvailable: { selectionId: string; label: string; market: string; book: string; american: number; edge: number } | null;
  positiveEv: number;
  evTiers: Record<EvTier, number>;
  arbitrage: number;
  booksConnected: number;
  booksTotal: number;
  marketsTracked: number;
  selectionsTracked: number;
  gamesTracked: number;
  liveGames: number;
  lineMovements: number;
  steamMoves: number;
  lastUpdate: string | null;
}

export interface OddsBoard {
  sport: OddsSport;
  label: string;
  status: ProviderStatus;
  games: OddsGame[];
  selections: Selection[];
  totalSelections: number;
  truncated: boolean;
  metrics: BoardMetrics;
  markets: MarketInfo[];
  books: BookInfo[];
  sharpBook: string | null;
  sizing: Sizing;
}

export interface MoveEvent {
  sideId: string; gameId: string; market: string; book: string; selection: string; participant: string;
  fromAmerican: number; toAmerican: number; fromPoint: number | null; toPoint: number | null; probabilityDelta: number; direction: number;
}

export interface GameDetail {
  sport: OddsSport;
  game: OddsGame;
  markets: Array<{ key: string; label: string; category: MarketCategory; type: MarketType; selections: Selection[] }>;
  status: ProviderStatus;
  eventMarketsLoaded: boolean;
  propsLoaded: boolean;
  books: BookInfo[];
  sizing: Sizing;
}

export interface MovementData {
  sport: OddsSport;
  status: ProviderStatus;
  movers: Array<{ selectionId: string; gameId: string; label: string; marketLabel: string; game: string; probabilityMove: number | null; pointMove: number | null; signals: SideSignals; best: Selection["best"]; books: number }>;
  steam: Array<{ selectionId: string; gameId: string; label: string; marketLabel: string; game: string; signals: SideSignals; best: Selection["best"] }>;
  sharp: MovementData["steam"];
  reverse: MovementData["steam"];
  sharpReference: string | null;
  movements: Array<{ sideId: string; gameId: string; market: string; book: string; selection: string; participant: string; fromAmerican: number; toAmerican: number; fromPoint: number | null; toPoint: number | null; probabilityDelta: number; direction: number; movedAt: string; label: string; game: string }>;
}

export interface HistoryData {
  sport: OddsSport;
  sideId: string;
  selection: { id: string; label: string; marketLabel: string; gameId: string; books: BookPrice[]; fair: FairValue | null; average: Selection["average"]; best: Selection["best"]; worst: Selection["worst"]; signals: SideSignals } | null;
  points: Array<{ book: string; american: number; point: number | null; at: string }>;
  /** Best / worst / average / fair over time (change-only). */
  range: Array<{ at: string; bestAmerican: number; bestBook: string; worstAmerican: number | null; worstBook: string | null; averageImplied: number | null; fairProbability: number | null; books: number }>;
}

export interface EvRow {
  selectionId: string; gameId: string; game: string; commenceTime: string | null; status: GameStatus | null; market: string; marketLabel: string;
  category: MarketCategory; label: string; book: string; american: number; decimal: number; implied: number; noVigProbability: number;
  fairAmerican: number | null; fairSource: string; fairBooks: number; ev: number; edge: number; kelly: number; tier: EvTier; risk: RiskRating | null; confidence: Confidence;
  marketAverage: number | null; bestPrice: boolean; lastChangeAt: string | null; signals: SideSignals;
}

export interface EvData {
  sport: OddsSport;
  status: ProviderStatus;
  rows: EvRow[];
  history: Array<{ sideId: string; book: string; american: number; gameId: string; market: string; label: string; peakEv: number; firstSeenAt: string; closedAt: string | null; durationSeconds: number }>;
  sizing: Sizing;
}

export interface ArbitrageLeg { selectionId: string; label: string; book: string; american: number; decimal: number; stakeShare: number; updatedAt: string }

export interface ArbitrageData {
  sport: OddsSport;
  status: ProviderStatus;
  total: number;
  opportunities: Array<{
    id: string; gameId: string; game: string; commenceTime: string | null; sport: OddsSport; market: string; marketLabel: string; participant: string;
    profitPct: number; peakProfitPct: number; guaranteedReturn: number; guaranteedProfit: number; legs: ArbitrageLeg[]; books: string[];
    rating: "strong" | "solid" | "thin"; oldestLegAt: string; firstSeenAt: string; stakes: Array<{ book: string; label: string; stake: number; payout: number }>;
  }>;
  recentlyClosed: Array<{ signature: string; gameId: string; market: string; participant: string; peakProfitPct: number; books: string[]; firstSeenAt: string; closedAt: string; durationSeconds: number }>;
}

export interface HitRateWindow { hits: number; games: number; rate: number | null }

export interface PropSide {
  selectionId: string;
  best: Selection["best"];
  average: Selection["average"];
  fair: FairValue | null;
  ev: number | null;
  tier: EvTier | null;
  books: Array<Pick<BookPrice, "book" | "american" | "point" | "atLine" | "isBest" | "priced" | "probabilityMove" | "pointMove" | "open" | "lastChangeAt">>;
  signals: SideSignals;
}

export interface PropRow {
  id: string; gameId: string; game: string; commenceTime: string | null; status: GameStatus | null; sport: OddsSport; market: string; marketLabel: string;
  type: MarketType; player: string; line: number | null; over: PropSide | null; under: PropSide | null; books: string[];
  openLine: number | null; lineMove: number | null; updatedAt: string;
  research: null | {
    playerId: string; headshot: string | null; team: string; opponent: string | null; line: number;
    l5: HitRateWindow; l10: HitRateWindow; season: HitRateWindow; home: HitRateWindow; away: HitRateWindow; vsOpponent: HitRateWindow;
    averageL10: number | null; averageSeason: number | null; recent: number[];
  };
}

export interface PropsData {
  sport: OddsSport;
  status: ProviderStatus;
  market: string | null;
  markets: Array<{ key: string; label: string; short: string; type: MarketType; available: boolean }>;
  games: OddsGame[];
  rows: PropRow[];
  research: { researched: number; unmatched: number; limit: number };
  requiresApiKey: boolean;
}

export type AlertType = "line_move" | "steam" | "sharp" | "reverse_move" | "positive_ev" | "arbitrage" | "best_price" | "clv";

export interface OddsAlert {
  id: number; type: AlertType; sport: OddsSport; gameId: string; game: string; market: string; sideId: string | null; book: string | null;
  title: string; message: string; severity: "info" | "notice" | "high"; value: number | null; createdAt: string; matchedRules?: number[];
}

export interface AlertRule {
  id: number; name: string; type: AlertType; sport: OddsSport | null; market: string | null; book: string | null; query: string | null;
  minValue: number | null; active: boolean; createdAt: string;
}

export type AlertRuleInput = Omit<AlertRule, "id" | "createdAt" | "active">;

export interface SearchResult {
  kind: "game" | "team" | "player" | "market" | "sportsbook" | "prop";
  label: string; detail: string; sport: OddsSport | null; gameId?: string; market?: string; book?: string; selectionId?: string;
}

export interface SportsbookRow {
  id: number | null; key: string; name: string; kind: BookInfo["kind"]; favorite: boolean; retired: string | null; prices: number; sports: OddsSport[]; status: BookInfo["status"];
}

export interface ClvData {
  rows: Array<{
    id: number; event: string; selection: string; market: string; sportsbook: string; result: string; betDate: string; stake: number; odds: number;
    closingOdds: number | null; clv: number | null; liveClv: number | null; status: "closed" | "tracking" | "unlinked";
    current: { american: number | null; fairProbability: number | null; best: Selection["best"] } | null;
  }>;
  summary: { bets: number; closed: number; tracking: number; averageClv: number | null; beatClosePct: number | null };
}

export interface OddsFavorite { kind: "market" | "prop" | "game"; itemKey: string; label: string; sport: OddsSport; createdAt?: string }

export interface BoardQuery {
  sport: OddsSport;
  category?: MarketCategory | "all";
  market?: string;
  book?: string;
  date?: string;
  q?: string;
  evOnly?: boolean;
  arbOnly?: boolean;
  live?: boolean;
  pregame?: boolean;
  gameId?: string;
}
