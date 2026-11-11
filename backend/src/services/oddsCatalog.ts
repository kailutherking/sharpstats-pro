/**
 * Sportsbook and market registry for the odds intelligence platform.
 *
 * Adding a sportsbook: append a BookDef (or set ODDS_EXTRA_BOOKS="key|Name|kind,...") with the
 * provider's bookmaker key. Adding a market: append a MarketDef to the sport's list; the provider
 * client requests it automatically and drops it if the provider rejects the key.
 */

export type OddsSport = "nba" | "nfl" | "mlb" | "nhl" | "ncaab";
export const ODDS_SPORTS: OddsSport[] = ["nba", "nfl", "mlb", "nhl", "ncaab"];

export const SPORT_CONFIG: Record<OddsSport, { label: string; oddsApiKey: string; espnPath: string }> = {
  nba: { label: "NBA", oddsApiKey: "basketball_nba", espnPath: "basketball/nba" },
  nfl: { label: "NFL", oddsApiKey: "americanfootball_nfl", espnPath: "football/nfl" },
  mlb: { label: "MLB", oddsApiKey: "baseball_mlb", espnPath: "baseball/mlb" },
  nhl: { label: "NHL", oddsApiKey: "icehockey_nhl", espnPath: "hockey/nhl" },
  ncaab: { label: "NCAAB", oddsApiKey: "basketball_ncaab", espnPath: "basketball/mens-college-basketball" },
};

export type BookKind = "sportsbook" | "dfs" | "reference";

export interface BookDef {
  key: string;
  name: string;
  kind: BookKind;
  /** Bookmaker key at The Odds API. */
  oddsApiKey?: string;
  /** Provider names ESPN uses for this book in its odds feed. */
  espnNames?: string[];
  /** Short note shown when a book can no longer be priced (e.g. it exited the US market). */
  retired?: string;
}

const CORE_BOOKS: BookDef[] = [
  { key: "draftkings", name: "DraftKings", kind: "sportsbook", oddsApiKey: "draftkings", espnNames: ["DraftKings"] },
  { key: "fanduel", name: "FanDuel", kind: "sportsbook", oddsApiKey: "fanduel", espnNames: ["FanDuel"] },
  { key: "betmgm", name: "BetMGM", kind: "sportsbook", oddsApiKey: "betmgm", espnNames: ["BetMGM"] },
  { key: "caesars", name: "Caesars", kind: "sportsbook", oddsApiKey: "williamhill_us", espnNames: ["Caesars", "Caesars Sportsbook", "William Hill"] },
  { key: "espnbet", name: "ESPN BET", kind: "sportsbook", oddsApiKey: "espnbet", espnNames: ["ESPN BET", "ESPN Bet"] },
  { key: "fanatics", name: "Fanatics", kind: "sportsbook", oddsApiKey: "fanatics", espnNames: ["Fanatics"] },
  { key: "prizepicks", name: "PrizePicks", kind: "dfs", oddsApiKey: "prizepicks" },
  { key: "underdog", name: "Underdog Fantasy", kind: "dfs", oddsApiKey: "underdog" },
  { key: "betrivers", name: "BetRivers", kind: "sportsbook", oddsApiKey: "betrivers", espnNames: ["BetRivers"] },
  {
    key: "pointsbet", name: "PointsBet", kind: "sportsbook",
    retired: "PointsBet US was acquired by Fanatics in 2024; its markets now price under Fanatics.",
  },
];

/** A sharp market-maker used only as the model reference (not shown as a bettable book by default). */
function referenceBooks(): BookDef[] {
  const key = (process.env.ODDS_SHARP_BOOK ?? "pinnacle").trim().toLowerCase();
  if (!key) return [];
  const name = key === "pinnacle" ? "Pinnacle" : key.replace(/(^|_)(\w)/g, (_m, _s, c: string) => c.toUpperCase());
  return [{ key, name, kind: "reference", oddsApiKey: key }];
}

function extraBooks(): BookDef[] {
  return (process.env.ODDS_EXTRA_BOOKS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [key = "", name = key, kind = "sportsbook"] = entry.split("|").map((part) => part.trim());
      return { key: key.toLowerCase(), name, kind: (["dfs", "reference"].includes(kind) ? kind : "sportsbook") as BookKind, oddsApiKey: key.toLowerCase() };
    })
    .filter((book) => /^[a-z0-9_]{2,40}$/.test(book.key));
}

let booksCache: BookDef[] | null = null;
export function getBooks(): BookDef[] {
  if (!booksCache) {
    const seen = new Set<string>();
    booksCache = [...CORE_BOOKS, ...extraBooks(), ...referenceBooks()].filter((book) => !seen.has(book.key) && Boolean(seen.add(book.key)));
  }
  return booksCache;
}

export function bookByKey(key: string): BookDef | undefined {
  return getBooks().find((book) => book.key === key);
}

export function bookByOddsApiKey(key: string): BookDef | undefined {
  return getBooks().find((book) => book.oddsApiKey === key);
}

export function bookByEspnName(name: string): BookDef | undefined {
  const lower = name.trim().toLowerCase();
  return getBooks().find((book) => book.espnNames?.some((candidate) => candidate.toLowerCase() === lower));
}

/** Books whose prices enter no-vig, EV and arbitrage math. DFS pick'em lines are shown but excluded. */
export function isPricedBook(key: string): boolean {
  const book = bookByKey(key);
  return Boolean(book && book.kind !== "dfs");
}

export type MarketCategory = "game" | "period" | "team" | "alternate" | "prop";
export type MarketType = "moneyline" | "spread" | "total" | "team_total" | "prop_ou" | "prop_yes";
export type MarketPeriod = "game" | "1h" | "2h" | "1q" | "1p" | "f5";

export interface MarketDef {
  key: string;
  label: string;
  short: string;
  category: MarketCategory;
  type: MarketType;
  period: MarketPeriod;
  /** Returned by the bulk /odds endpoint (cheap); others need per-event requests. */
  featured?: boolean;
  /** Stat identifier for prop hit-rate research (see propResearch.service). */
  stat?: string;
}

const gameMarkets = (period: MarketPeriod, suffix: string, labelPrefix: string, category: MarketCategory = "period"): MarketDef[] => [
  { key: `h2h${suffix}`, label: `${labelPrefix} moneyline`, short: `${labelPrefix} ML`, category, type: "moneyline", period },
  { key: `spreads${suffix}`, label: `${labelPrefix} spread`, short: `${labelPrefix} SPR`, category, type: "spread", period },
  { key: `totals${suffix}`, label: `${labelPrefix} total`, short: `${labelPrefix} TOT`, category, type: "total", period },
];

const fullGame = (spreadLabel: string): MarketDef[] => [
  { key: "h2h", label: "Moneyline", short: "ML", category: "game", type: "moneyline", period: "game", featured: true },
  { key: "spreads", label: spreadLabel, short: spreadLabel === "Spread" ? "SPR" : spreadLabel.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3), category: "game", type: "spread", period: "game", featured: true },
  { key: "totals", label: "Total", short: "TOT", category: "game", type: "total", period: "game", featured: true },
];

const teamAndAlternates = (spreadLabel: string, alternateTotals = true): MarketDef[] => [
  { key: "team_totals", label: "Team totals", short: "TEAM TOT", category: "team", type: "team_total", period: "game" },
  { key: "alternate_spreads", label: `Alternate ${spreadLabel.toLowerCase()}s`, short: "ALT SPR", category: "alternate", type: "spread", period: "game" },
  ...(alternateTotals ? [{ key: "alternate_totals", label: "Alternate totals", short: "ALT TOT", category: "alternate" as const, type: "total" as const, period: "game" as const }] : []),
];

const prop = (key: string, label: string, short: string, stat?: string, type: MarketType = "prop_ou"): MarketDef =>
  ({ key, label, short, category: "prop", type, period: "game", stat });

export const MARKETS: Record<OddsSport, MarketDef[]> = {
  nba: [
    ...fullGame("Spread"),
    ...gameMarkets("1h", "_h1", "1st half"),
    ...gameMarkets("1q", "_q1", "1st quarter"),
    ...teamAndAlternates("Spread"),
    prop("player_points", "Points", "PTS", "nba.points"),
    prop("player_rebounds", "Rebounds", "REB", "nba.rebounds"),
    prop("player_assists", "Assists", "AST", "nba.assists"),
    prop("player_threes", "3PT made", "3PM", "nba.threes"),
    prop("player_points_rebounds", "Points + rebounds", "P+R", "nba.pr"),
    prop("player_points_assists", "Points + assists", "P+A", "nba.pa"),
    prop("player_rebounds_assists", "Rebounds + assists", "R+A", "nba.ra"),
    prop("player_points_rebounds_assists", "Pts + reb + ast", "PRA", "nba.pra"),
    prop("player_steals", "Steals", "STL", "nba.steals"),
    prop("player_blocks", "Blocks", "BLK", "nba.blocks"),
    prop("player_turnovers", "Turnovers", "TOV", "nba.turnovers"),
    prop("player_double_double", "Double double", "DBL-DBL", "nba.doubleDouble", "prop_yes"),
    prop("player_triple_double", "Triple double", "TRP-DBL", "nba.tripleDouble", "prop_yes"),
    prop("player_fantasy_points", "Fantasy points", "FPTS", "nba.fantasy"),
    prop("player_minutes", "Minutes", "MIN", "nba.minutes"),
  ],
  nfl: [
    ...fullGame("Spread"),
    ...gameMarkets("1h", "_h1", "1st half"),
    ...gameMarkets("1q", "_q1", "1st quarter"),
    ...teamAndAlternates("Spread"),
    prop("player_pass_yds", "Passing yards", "PASS YDS", "nfl.passYds"),
    prop("player_pass_tds", "Passing TDs", "PASS TD", "nfl.passTds"),
    prop("player_pass_attempts", "Passing attempts", "ATT", "nfl.passAtt"),
    prop("player_pass_completions", "Completions", "CMP", "nfl.completions"),
    prop("player_pass_interceptions", "Interceptions", "INT", "nfl.interceptions"),
    prop("player_rush_yds", "Rushing yards", "RUSH YDS", "nfl.rushYds"),
    prop("player_rush_attempts", "Rushing attempts", "CAR", "nfl.rushAtt"),
    prop("player_reception_yds", "Receiving yards", "REC YDS", "nfl.recYds"),
    prop("player_receptions", "Receptions", "REC", "nfl.receptions"),
    prop("player_reception_longest", "Longest reception", "LONG REC", "nfl.longRec"),
    prop("player_anytime_td", "Anytime TD", "ATD", "nfl.anytimeTd", "prop_yes"),
    prop("player_1st_td", "First TD", "1ST TD", undefined, "prop_yes"),
    prop("player_last_td", "Last TD", "LAST TD", undefined, "prop_yes"),
    prop("player_fantasy_points", "Fantasy points", "FPTS", "nfl.fantasy"),
  ],
  mlb: [
    ...fullGame("Run line"),
    ...gameMarkets("f5", "_1st_5_innings", "1st 5 innings"),
    ...teamAndAlternates("Run line"),
    prop("batter_hits", "Hits", "H", "mlb.hits"),
    prop("batter_runs_scored", "Runs", "R", "mlb.runs"),
    prop("batter_rbis", "RBIs", "RBI", "mlb.rbis"),
    prop("batter_home_runs", "Home runs", "HR", "mlb.homeRuns"),
    prop("batter_total_bases", "Total bases", "TB", "mlb.totalBases"),
    prop("batter_singles", "Singles", "1B", "mlb.singles"),
    prop("batter_doubles", "Doubles", "2B", "mlb.doubles"),
    prop("pitcher_strikeouts", "Strikeouts", "K", "mlb.strikeouts"),
    prop("pitcher_outs", "Pitching outs", "OUTS", "mlb.outs"),
    prop("pitcher_earned_runs", "Earned runs", "ER", "mlb.earnedRuns"),
    prop("pitcher_walks", "Walks allowed", "BB", "mlb.walks"),
    prop("batter_fantasy_score", "Fantasy points", "FPTS", "mlb.fantasy"),
  ],
  nhl: [
    ...fullGame("Puck line"),
    ...gameMarkets("1p", "_p1", "1st period"),
    ...teamAndAlternates("Puck line"),
    prop("player_goals", "Goals", "G", "nhl.goals"),
    prop("player_assists", "Assists", "A", "nhl.assists"),
    prop("player_points", "Points", "PTS", "nhl.points"),
    prop("player_shots_on_goal", "Shots on goal", "SOG", "nhl.shots"),
    prop("player_blocked_shots", "Blocked shots", "BLK", "nhl.blockedShots"),
    prop("player_power_play_points", "Power play points", "PPP", "nhl.ppp"),
    prop("player_total_saves", "Goalie saves", "SV", "nhl.saves"),
    prop("player_save_percentage", "Save percentage", "SV%", "nhl.savePct"),
    prop("player_fantasy_points", "Fantasy points", "FPTS", "nhl.fantasy"),
  ],
  // College games are two 20-minute halves, so there are half markets but no quarters.
  ncaab: [
    ...fullGame("Spread"),
    ...gameMarkets("1h", "_h1", "1st half"),
    ...gameMarkets("2h", "_h2", "2nd half"),
    ...teamAndAlternates("Spread"),
    prop("player_points", "Points", "PTS", "nba.points"),
    prop("player_rebounds", "Rebounds", "REB", "nba.rebounds"),
    prop("player_assists", "Assists", "AST", "nba.assists"),
    prop("player_threes", "3PT made", "3PM", "nba.threes"),
    prop("player_points_rebounds", "Points + rebounds", "P+R", "nba.pr"),
    prop("player_points_assists", "Points + assists", "P+A", "nba.pa"),
    prop("player_rebounds_assists", "Rebounds + assists", "R+A", "nba.ra"),
    prop("player_points_rebounds_assists", "Pts + reb + ast", "PRA", "nba.pra"),
    prop("player_steals", "Steals", "STL", "nba.steals"),
    prop("player_blocks", "Blocks", "BLK", "nba.blocks"),
    prop("player_turnovers", "Turnovers", "TOV", "nba.turnovers"),
    prop("player_double_double", "Double double", "DBL-DBL", "nba.doubleDouble", "prop_yes"),
  ],
};

export function marketDef(sport: OddsSport, key: string): MarketDef | undefined {
  return MARKETS[sport].find((market) => market.key === key);
}

export function featuredMarkets(sport: OddsSport): MarketDef[] {
  return MARKETS[sport].filter((market) => market.featured);
}

export function eventMarkets(sport: OddsSport): MarketDef[] {
  return MARKETS[sport].filter((market) => !market.featured && market.category !== "prop");
}

export function propMarkets(sport: OddsSport): MarketDef[] {
  return MARKETS[sport].filter((market) => market.category === "prop");
}
