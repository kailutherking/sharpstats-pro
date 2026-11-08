export type League = "nba" | "nfl" | "mlb" | "nhl";
export type StatsWindow = "season" | "last10" | "last30";
export type StatFormat = "int" | "dec1" | "dec2" | "pct1" | "rate3" | "signed" | "minutes" | "innings";

export interface SeasonInfo {
  year: number;
  displayName: string;
  type: string;
}

export interface ColumnMeta {
  key: string;
  label: string;
  short: string;
  format: StatFormat;
  direction: "asc" | "desc";
}

export interface PlayerRow {
  id: string;
  name: string;
  shortName: string;
  headshot: string | null;
  position: string;
  positionName: string;
  age: number | null;
  status: string;
  teamId: string;
  teamAbbr: string;
  teamName: string;
  groups: string[];
  tags: string[];
  values: Record<string, number | null>;
  sample?: number;
}

export interface LeaderEntry {
  rank: number;
  id: string;
  name: string;
  shortName: string;
  headshot: string | null;
  teamAbbr: string;
  position: string;
  value: number;
  sample?: number;
}

export interface LeaderBoard extends ColumnMeta {
  group: string;
  leaders: LeaderEntry[];
}

export interface TeamRow {
  id: string;
  name: string;
  shortName: string;
  abbr: string;
  logo: string | null;
  conference: string;
  conferenceAbbr: string;
  division: string;
  wins: number;
  losses: number;
  ties: number;
  otLosses: number;
  gamesPlayed: number;
  record: string;
  home: string;
  away: string;
  winPct: number | null;
  streak: string;
  last10: string;
  values: Record<string, number | null>;
  offRank: number | null;
  defRank: number | null;
}

export interface PlayerGroup {
  key: string;
  label: string;
  primary: string;
  columns: ColumnMeta[];
}

export interface LeagueStats {
  league: League;
  name: string;
  season: SeasonInfo;
  window: StatsWindow;
  windowNote: string | null;
  source: string;
  fetchedAt: string;
  nextRefreshAt: string;
  refreshMinutes: number;
  stale: boolean;
  groups: PlayerGroup[];
  leaders: LeaderBoard[];
  players: PlayerRow[];
  teams: TeamRow[];
  teamColumns: ColumnMeta[];
  offenseMetric: string;
  defenseMetric: string;
  unavailableMetrics: string[];
  conferenceLabel: string;
  pointsLabel: string;
  filters: {
    teams: Array<{ id: string; abbr: string; name: string; conference: string; division: string }>;
    positions: string[];
    conferences: string[];
    divisions: Array<{ name: string; conference: string }>;
  };
}

export interface HitRate {
  hits: number;
  games: number;
}

export interface PropMetric {
  key: string;
  label: string;
  short: string;
  format: StatFormat;
  direction: "over" | "under";
  lines: number[];
  line: number | null;
  seasonAvg: number | null;
  last5Avg: number | null;
  last10Avg: number | null;
  median10: number | null;
  stdDev10: number | null;
  high10: number | null;
  low10: number | null;
  homeAvg: number | null;
  awayAvg: number | null;
  homeGames: number;
  awayGames: number;
  hitRate: { last5: HitRate; last10: HitRate; season: HitRate };
  streak: number;
  trend: number | null;
  values: Array<number | null>;
}

export interface Insight {
  id: string;
  tone: "positive" | "negative" | "neutral";
  stat: string;
  headline: string;
  detail: string;
  strength: number;
}

export interface SplitRow {
  label: string;
  games: number;
  averages: Record<string, number | null>;
}

export interface GameLogRow {
  eventId: string;
  date: string;
  home: boolean;
  opponentId: string;
  opponentAbbr: string;
  opponentName: string;
  opponentLogo: string | null;
  result: string;
  score: string;
  values: Record<string, number | null>;
  display: Record<string, string>;
}

export interface PlayerProfile {
  league: League;
  season: SeasonInfo;
  window: StatsWindow;
  fetchedAt: string;
  stale: boolean;
  source: string;
  player: {
    id: string;
    name: string;
    headshot: string | null;
    jersey: string;
    position: string;
    positionName: string;
    height: string;
    weight: string;
    age: number | null;
    birthDate: string;
    status: string;
    experience: string;
    teamId: string;
    teamName: string;
    teamAbbr: string;
    teamLogo: string | null;
    teamColor: string | null;
    teamRecord: string | null;
    conference: string | null;
    division: string | null;
  };
  group: { key: string; label: string; unit: "games" | "starts" | "appearances" };
  seasonStats: Array<ColumnMeta & { season: number | null; window: number | null }>;
  gameLog: { columns: Array<{ key: string; label: string }>; games: GameLogRow[]; windowEventIds: string[] };
  propMetrics: PropMetric[];
  insights: Insight[];
  splits: { homeAway: SplitRow[]; opponents: SplitRow[] };
  career: {
    category: string;
    columns: Array<{ key: string; label: string }>;
    seasons: Array<{ year: number; label: string; teamId: string; values: Record<string, number | null> }>;
  } | null;
}

export interface TeamGame {
  eventId: string;
  date: string;
  home: boolean;
  opponentId: string;
  opponentAbbr: string;
  opponentLogo: string | null;
  pointsFor: number;
  pointsAgainst: number;
  result: "W" | "L" | "T";
}

export interface TeamProfile {
  league: League;
  season: SeasonInfo;
  fetchedAt: string;
  stale: boolean;
  source: string;
  team: TeamRow;
  teamColumns: ColumnMeta[];
  pointsLabel: string;
  unavailableMetrics: string[];
  games: TeamGame[];
  splits: Array<{ label: string; games: number; record: string; pointsFor: number | null; pointsAgainst: number | null }>;
  insights: Insight[];
  topPlayers: Array<{ group: string; label: string; metric: ColumnMeta; players: Array<{ id: string; name: string; headshot: string | null; position: string; value: number }> }>;
}

export interface FavoriteStat {
  league: League;
  entity_type: "player" | "team";
  entity_id: string;
  name: string;
  team_abbr: string;
  image_url: string | null;
  created_at: string;
}

export interface FavoriteInput {
  league: League;
  entityType: "player" | "team";
  entityId: string;
  name: string;
  teamAbbr: string;
  imageUrl: string | null;
  favorite: boolean;
}
