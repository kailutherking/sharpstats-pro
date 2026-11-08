import { inningsToDecimal, type League, type ProviderAthlete, type ProviderGame, type ProviderStanding, type ProviderTeamStats } from "../providers/espnStats";

export type StatFormat = "int" | "dec1" | "dec2" | "pct1" | "rate3" | "signed" | "minutes" | "innings";
type Stats = Record<string, number | null>;
type GameValues = Record<string, number | null>;

export interface MetricDef {
  key: string;
  label: string;
  short: string;
  format: StatFormat;
  /** Ranking direction: "asc" means lower is better (ERA, GAA). */
  direction: "asc" | "desc";
  season: (stats: Stats) => number | null;
  /** Recomputes the metric from a window of game-log rows (Last 10 games / Last 30 days). */
  window?: (games: ProviderGame[]) => number | null;
}

export interface PropStatDef {
  key: string;
  label: string;
  short: string;
  format: StatFormat;
  value: (game: GameValues) => number | null;
  /** Common sportsbook milestone lines, ascending. */
  lines: number[];
  /** "under" props count a hit when the value is at or below the line (e.g. earned runs allowed). */
  direction: "over" | "under";
}

export interface PlayerGroupDef {
  key: string;
  label: string;
  includes: (athlete: ProviderAthlete) => boolean;
  primary: string;
  columns: string[];
  gameLogCategory?: "batting" | "pitching";
  /** What one game-log row is called in insights. */
  unit: (athlete: Pick<ProviderAthlete, "position">) => "games" | "starts" | "appearances";
  props: PropStatDef[];
}

export interface LeaderDef {
  metric: string;
  group: string;
  /** Season qualification, e.g. ESPN's qualified-player flag for rate stats. */
  qualify?: (athlete: ProviderAthlete) => boolean;
  /** Minimum sample inside a Last 10 / Last 30 window. */
  windowQualify?: (games: ProviderGame[]) => boolean;
}

export interface TeamContext {
  standing: ProviderStanding;
  stats: ProviderTeamStats | undefined;
  gamesPlayed: number;
  extras: Record<string, number | null>;
}

export interface TeamMetricDef {
  key: string;
  label: string;
  short: string;
  format: StatFormat;
  direction: "asc" | "desc";
  compute: (context: TeamContext) => number | null;
}

export interface LeagueDefinition {
  league: League;
  name: string;
  metrics: Record<string, MetricDef>;
  groups: PlayerGroupDef[];
  leaders: LeaderDef[];
  teamMetrics: TeamMetricDef[];
  offenseMetric: string;
  defenseMetric: string;
  /** Team names/labels of advanced metrics the provider does not publish. */
  unavailableMetrics: string[];
  conferenceLabel: string;
  pointsLabel: string;
}

const stat = (key: string) => (stats: Stats) => stats[key] ?? null;
const valuesOf = (games: ProviderGame[], key: string) => games.map((game) => game.values[key]).filter((value): value is number => typeof value === "number");
const sumG = (key: string) => (games: ProviderGame[]) => games.length ? valuesOf(games, key).reduce((sum, value) => sum + value, 0) : null;
const avgG = (key: string) => (games: ProviderGame[]) => {
  const values = valuesOf(games, key);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};
const total = (games: ProviderGame[], keys: string[]) => keys.reduce((sum, key) => sum + (valuesOf(games, key).reduce((a, b) => a + b, 0)), 0);
const ratioG = (numerator: string[], denominator: string[], scale = 1) => (games: ProviderGame[]) => {
  const bottom = total(games, denominator);
  return bottom > 0 ? total(games, numerator) / bottom * scale : null;
};
const countG = (games: ProviderGame[]) => games.length;
const gameValue = (key: string) => (game: GameValues) => game[key] ?? null;
const gameSum = (...keys: string[]) => (game: GameValues) => {
  const parts = keys.map((key) => game[key]);
  return parts.some((part) => part === null || part === undefined) ? null : (parts as number[]).reduce((a, b) => a + b, 0);
};
const always = () => "games" as const;
const sumStats = (...keys: string[]) => (stats: Stats) => {
  const parts = keys.map((key) => stats[key]);
  return parts.every((part) => part === null || part === undefined) ? null : parts.reduce<number>((sum, part) => sum + (part ?? 0), 0);
};
const hasTag = (tag: string) => (athlete: ProviderAthlete) => athlete.tags.includes(tag);
const minGames = (count: number) => (games: ProviderGame[]) => games.length >= count;
const minTotal = (key: string, count: number) => (games: ProviderGame[]) => total(games, [key]) >= count;

function metric(key: string, label: string, short: string, format: StatFormat, season: MetricDef["season"], window?: MetricDef["window"], direction: "asc" | "desc" = "desc"): MetricDef {
  return { key, label, short, format, direction, season, window };
}
function prop(key: string, label: string, short: string, value: PropStatDef["value"], lines: number[], format: StatFormat = "dec1", direction: "over" | "under" = "over"): PropStatDef {
  return { key, label, short, format, value, lines, direction };
}
const index = (metrics: MetricDef[]) => Object.fromEntries(metrics.map((item) => [item.key, item]));

/* NFL passer rating from game totals. */
function passerRating(games: ProviderGame[]): number | null {
  const attempts = total(games, ["passingAttempts"]);
  if (!attempts) return null;
  const clamp = (value: number) => Math.max(0, Math.min(2.375, value));
  const a = clamp((total(games, ["completions"]) / attempts - 0.3) * 5);
  const b = clamp((total(games, ["passingYards"]) / attempts - 3) * 0.25);
  const c = clamp(total(games, ["passingTouchdowns"]) / attempts * 20);
  const d = clamp(2.375 - total(games, ["interceptions"]) / attempts * 25);
  return (a + b + c + d) / 6 * 100;
}
const totalBases = (game: GameValues) => {
  const { hits, doubles, triples, homeRuns } = game;
  if ([hits, doubles, triples, homeRuns].some((value) => value === null || value === undefined)) return null;
  return hits! + doubles! + 2 * triples! + 3 * homeRuns!;
};
function slugging(games: ProviderGame[]) {
  const atBats = total(games, ["atBats"]);
  if (!atBats) return null;
  return games.reduce((sum, game) => sum + (totalBases(game.values) ?? 0), 0) / atBats;
}
function onBase(games: ProviderGame[]) {
  const denominator = total(games, ["atBats", "walks", "hitByPitch"]);
  return denominator ? total(games, ["hits", "walks", "hitByPitch"]) / denominator : null;
}
const pitchingRate = (numerator: string[], scale: number) => (games: ProviderGame[]) => {
  const innings = total(games, ["innings"]);
  return innings > 0 ? total(games, numerator) / innings * scale : null;
};

/* Team helpers. */
const teamStat = (side: "own" | "opponent", key: string) => (context: TeamContext) => context.stats?.[side][key] ?? null;
const perGame = (value: number | null, games: number) => value === null || !games ? null : value / games;
const standingValue = (context: TeamContext, key: string) => context.standing.stats[key]?.value ?? null;
function nbaPossessions(stats: Stats | undefined) {
  if (!stats) return null;
  const fga = stats["offensive.avgFieldGoalsAttempted"];
  const oreb = stats["offensive.avgOffensiveRebounds"];
  const tov = stats["offensive.avgTurnovers"];
  const fta = stats["offensive.avgFreeThrowsAttempted"];
  if ([fga, oreb, tov, fta].some((value) => value === null || value === undefined)) return null;
  return fga! - oreb! + tov! + 0.44 * fta!;
}
function nbaPace(context: TeamContext) {
  const own = nbaPossessions(context.stats?.own);
  const opponent = nbaPossessions(context.stats?.opponent);
  return own === null || opponent === null ? null : (own + opponent) / 2;
}
function nbaRating(context: TeamContext, side: "own" | "opponent") {
  const pace = nbaPace(context);
  const points = context.stats?.[side]["offensive.avgPoints"] ?? null;
  return pace && points !== null ? points / pace * 100 : null;
}
function nflYardsPerPlay(context: TeamContext, side: "own" | "opponent") {
  const stats = context.stats?.[side];
  if (!stats) return null;
  const plays = (stats["passing.passingAttempts"] ?? 0) + (stats["passing.sacks"] ?? 0) + (stats["rushing.rushingAttempts"] ?? 0);
  const yards = (stats["passing.netPassingYards"] ?? 0) + (stats["rushing.rushingYards"] ?? 0);
  return plays > 0 ? yards / plays : null;
}

const pointsForPerGame: TeamMetricDef = { key: "pointsForPerGame", label: "Points scored per game", short: "PF/G", format: "dec1", direction: "desc", compute: (context) => standingValue(context, "avgpointsfor") ?? perGame(standingValue(context, "pointsfor"), context.gamesPlayed) };
const pointsAgainstPerGame: TeamMetricDef = { key: "pointsAgainstPerGame", label: "Points allowed per game", short: "PA/G", format: "dec1", direction: "asc", compute: (context) => standingValue(context, "avgpointsagainst") ?? perGame(standingValue(context, "pointsagainst"), context.gamesPlayed) };

/* ---------------------------------- NBA ---------------------------------- */
const nbaMetrics = index([
  metric("gp", "Games played", "GP", "int", stat("general.gamesPlayed"), countG),
  metric("min", "Minutes per game", "MIN", "dec1", stat("general.avgMinutes"), avgG("minutes")),
  metric("pts", "Points per game", "PTS", "dec1", stat("offensive.avgPoints"), avgG("points")),
  metric("reb", "Rebounds per game", "REB", "dec1", stat("general.avgRebounds"), avgG("totalRebounds")),
  metric("ast", "Assists per game", "AST", "dec1", stat("offensive.avgAssists"), avgG("assists")),
  metric("stl", "Steals per game", "STL", "dec1", stat("defensive.avgSteals"), avgG("steals")),
  metric("blk", "Blocks per game", "BLK", "dec1", stat("defensive.avgBlocks"), avgG("blocks")),
  metric("tov", "Turnovers per game", "TO", "dec1", stat("offensive.avgTurnovers"), avgG("turnovers"), "asc"),
  metric("tpm", "3-pointers made per game", "3PM", "dec1", stat("offensive.avgThreePointFieldGoalsMade"), avgG("threePointFieldGoalsMade")),
  metric("pra", "Points + rebounds + assists", "PRA", "dec1", sumStats("offensive.avgPoints", "general.avgRebounds", "offensive.avgAssists"),
    (games) => { const values = games.map((game) => gameSum("points", "totalRebounds", "assists")(game.values)).filter((v): v is number => v !== null); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }),
  metric("fgPct", "Field goal percentage", "FG%", "pct1", stat("offensive.fieldGoalPct"), ratioG(["fieldGoalsMade"], ["fieldGoalsAttempted"], 100)),
  metric("tpPct", "3-point percentage", "3P%", "pct1", stat("offensive.threePointFieldGoalPct"), ratioG(["threePointFieldGoalsMade"], ["threePointFieldGoalsAttempted"], 100)),
  metric("ftPct", "Free throw percentage", "FT%", "pct1", stat("offensive.freeThrowPct"), ratioG(["freeThrowsMade"], ["freeThrowsAttempted"], 100)),
]);
const nba: LeagueDefinition = {
  league: "nba",
  name: "NBA",
  metrics: nbaMetrics,
  groups: [{
    key: "players", label: "Players", includes: (athlete) => (athlete.stats["general.gamesPlayed"] ?? 0) > 0, primary: "pts", unit: always,
    columns: ["gp", "min", "pts", "reb", "ast", "stl", "blk", "tov", "tpm", "pra", "fgPct", "tpPct", "ftPct"],
    props: [
      prop("points", "Points", "PTS", gameValue("points"), [10, 15, 20, 25, 30, 35, 40, 45]),
      prop("rebounds", "Rebounds", "REB", gameValue("totalRebounds"), [4, 6, 8, 10, 12, 15]),
      prop("assists", "Assists", "AST", gameValue("assists"), [3, 5, 7, 9, 11, 13]),
      prop("threes", "3-pointers made", "3PM", gameValue("threePointFieldGoalsMade"), [1, 2, 3, 4, 5, 6]),
      prop("pra", "Pts + Reb + Ast", "PRA", gameSum("points", "totalRebounds", "assists"), [15, 20, 25, 30, 35, 40, 45, 50, 55]),
      prop("stocks", "Steals + Blocks", "STL+BLK", gameSum("steals", "blocks"), [1, 2, 3, 4]),
    ],
  }],
  leaders: [
    { metric: "pts", group: "players", qualify: hasTag("qualified"), windowQualify: minGames(3) },
    { metric: "reb", group: "players", qualify: hasTag("qualified"), windowQualify: minGames(3) },
    { metric: "ast", group: "players", qualify: hasTag("qualified"), windowQualify: minGames(3) },
    { metric: "stl", group: "players", qualify: hasTag("qualified"), windowQualify: minGames(3) },
    { metric: "blk", group: "players", qualify: hasTag("qualified"), windowQualify: minGames(3) },
    { metric: "tpPct", group: "players", qualify: (a) => hasTag("qualified")(a) && (a.stats["offensive.avgThreePointFieldGoalsAttempted"] ?? 0) >= 2.5, windowQualify: minTotal("threePointFieldGoalsAttempted", 15) },
    { metric: "fgPct", group: "players", qualify: (a) => hasTag("qualified")(a) && (a.stats["offensive.avgFieldGoalsAttempted"] ?? 0) >= 6, windowQualify: minTotal("fieldGoalsAttempted", 40) },
    { metric: "min", group: "players", qualify: hasTag("qualified"), windowQualify: minGames(3) },
  ],
  teamMetrics: [
    pointsForPerGame,
    pointsAgainstPerGame,
    { key: "offRating", label: "Offensive rating", short: "ORTG", format: "dec1", direction: "desc", compute: (c) => nbaRating(c, "own") },
    { key: "defRating", label: "Defensive rating", short: "DRTG", format: "dec1", direction: "asc", compute: (c) => nbaRating(c, "opponent") },
    { key: "netRating", label: "Net rating", short: "NET", format: "signed", direction: "desc", compute: (c) => { const o = nbaRating(c, "own"); const d = nbaRating(c, "opponent"); return o === null || d === null ? null : o - d; } },
    { key: "pace", label: "Pace (possessions per game)", short: "PACE", format: "dec1", direction: "desc", compute: nbaPace },
    { key: "fgPct", label: "Field goal percentage", short: "FG%", format: "pct1", direction: "desc", compute: teamStat("own", "offensive.fieldGoalPct") },
    { key: "tpPct", label: "3-point percentage", short: "3P%", format: "pct1", direction: "desc", compute: teamStat("own", "offensive.threePointFieldGoalPct") },
  ],
  offenseMetric: "offRating",
  defenseMetric: "defRating",
  unavailableMetrics: [],
  conferenceLabel: "Conference",
  pointsLabel: "Points",
};

/* ---------------------------------- NFL ---------------------------------- */
const OFFENSE_POSITIONS = new Set(["QB", "RB", "FB", "WR", "TE", "OT", "OG", "C", "G", "T", "OL", "K", "PK", "P", "LS"]);
const nflMetrics = index([
  metric("gp", "Games played", "GP", "int", stat("general.gamesPlayed"), countG),
  metric("cmp", "Completions", "CMP", "int", stat("passing.completions"), sumG("completions")),
  metric("att", "Pass attempts", "ATT", "int", stat("passing.passingAttempts"), sumG("passingAttempts")),
  metric("cmpPct", "Completion percentage", "CMP%", "pct1", stat("passing.completionPct"), ratioG(["completions"], ["passingAttempts"], 100)),
  metric("passYds", "Passing yards", "YDS", "int", stat("passing.passingYards"), sumG("passingYards")),
  metric("passYpg", "Passing yards per game", "YDS/G", "dec1", stat("passing.passingYardsPerGame"), avgG("passingYards")),
  metric("passTd", "Passing touchdowns", "TD", "int", stat("passing.passingTouchdowns"), sumG("passingTouchdowns")),
  metric("int", "Interceptions thrown", "INT", "int", stat("passing.interceptions"), sumG("interceptions"), "asc"),
  metric("rating", "Passer rating", "RTG", "dec1", stat("passing.QBRating"), passerRating),
  metric("rushAtt", "Rush attempts", "ATT", "int", stat("rushing.rushingAttempts"), sumG("rushingAttempts")),
  metric("rushYds", "Rushing yards", "YDS", "int", stat("rushing.rushingYards"), sumG("rushingYards")),
  metric("ypc", "Yards per carry", "YPC", "dec1", stat("rushing.yardsPerRushAttempt"), ratioG(["rushingYards"], ["rushingAttempts"])),
  metric("rushTd", "Rushing touchdowns", "TD", "int", stat("rushing.rushingTouchdowns"), sumG("rushingTouchdowns")),
  metric("rushYpg", "Rushing yards per game", "YDS/G", "dec1", stat("rushing.rushingYardsPerGame"), avgG("rushingYards")),
  metric("rec", "Receptions", "REC", "int", stat("receiving.receptions"), sumG("receptions")),
  metric("tgt", "Targets", "TGT", "int", stat("receiving.receivingTargets"), sumG("receivingTargets")),
  metric("recYds", "Receiving yards", "YDS", "int", stat("receiving.receivingYards"), sumG("receivingYards")),
  metric("ypr", "Yards per reception", "Y/R", "dec1", stat("receiving.yardsPerReception"), ratioG(["receivingYards"], ["receptions"])),
  metric("recTd", "Receiving touchdowns", "TD", "int", stat("receiving.receivingTouchdowns"), sumG("receivingTouchdowns")),
  metric("recYpg", "Receiving yards per game", "YDS/G", "dec1", stat("receiving.receivingYardsPerGame"), avgG("receivingYards")),
  metric("tackles", "Total tackles", "TCKL", "int", stat("defensive.totalTackles"), sumG("totalTackles")),
  metric("sacks", "Sacks", "SACK", "dec1", stat("defensive.sacks"), sumG("sacks")),
  metric("tfl", "Tackles for loss", "TFL", "int", stat("defensive.tacklesForLoss")),
  metric("pd", "Passes defended", "PD", "int", stat("defensive.passesDefended"), sumG("passesDefended")),
  metric("defInt", "Interceptions", "INT", "int", stat("defensiveinterceptions.interceptions"), sumG("interceptions")),
  metric("ff", "Forced fumbles", "FF", "int", stat("general.fumblesForced"), sumG("fumblesForced")),
]);
const nflUnit = always;
const nfl: LeagueDefinition = {
  league: "nfl",
  name: "NFL",
  metrics: nflMetrics,
  groups: [
    {
      key: "passing", label: "Passing", includes: (a) => (a.stats["passing.passingAttempts"] ?? 0) >= 5, primary: "passYds", unit: nflUnit,
      columns: ["gp", "cmp", "att", "cmpPct", "passYds", "passYpg", "passTd", "int", "rating"],
      props: [
        prop("passingYards", "Passing yards", "PASS YDS", gameValue("passingYards"), [175, 200, 225, 250, 275, 300, 325, 350], "int"),
        prop("passingTouchdowns", "Passing touchdowns", "PASS TD", gameValue("passingTouchdowns"), [1, 2, 3, 4], "int"),
        prop("completions", "Completions", "CMP", gameValue("completions"), [15, 18, 20, 22, 25, 28], "int"),
        prop("passingAttempts", "Pass attempts", "ATT", gameValue("passingAttempts"), [25, 30, 35, 40], "int"),
        prop("qbRushingYards", "Rushing yards", "RUSH YDS", gameValue("rushingYards"), [10, 20, 30, 40, 50], "int"),
      ],
    },
    {
      key: "rushing", label: "Rushing", includes: (a) => (a.stats["rushing.rushingAttempts"] ?? 0) >= 5, primary: "rushYds", unit: nflUnit,
      columns: ["gp", "rushAtt", "rushYds", "ypc", "rushTd", "rushYpg", "rec", "recYds"],
      props: [
        prop("rushingYards", "Rushing yards", "RUSH YDS", gameValue("rushingYards"), [30, 40, 50, 60, 70, 80, 100, 120], "int"),
        prop("rushingAttempts", "Rush attempts", "CAR", gameValue("rushingAttempts"), [8, 10, 12, 15, 18, 20], "int"),
        prop("rushingTouchdowns", "Rushing touchdowns", "RUSH TD", gameValue("rushingTouchdowns"), [1, 2], "int"),
        prop("rbReceptions", "Receptions", "REC", gameValue("receptions"), [1, 2, 3, 4, 5], "int"),
        prop("rushRecYards", "Rush + rec yards", "R+R YDS", gameSum("rushingYards", "receivingYards"), [50, 60, 75, 90, 100, 125], "int"),
      ],
    },
    {
      key: "receiving", label: "Receiving", includes: (a) => (a.stats["receiving.receptions"] ?? 0) >= 3, primary: "recYds", unit: nflUnit,
      columns: ["gp", "rec", "tgt", "recYds", "ypr", "recTd", "recYpg"],
      props: [
        prop("receptions", "Receptions", "REC", gameValue("receptions"), [2, 3, 4, 5, 6, 7, 8, 10], "int"),
        prop("receivingYards", "Receiving yards", "REC YDS", gameValue("receivingYards"), [30, 40, 50, 60, 70, 80, 90, 100, 125], "int"),
        prop("receivingTouchdowns", "Receiving touchdowns", "REC TD", gameValue("receivingTouchdowns"), [1, 2], "int"),
        prop("targets", "Targets", "TGT", gameValue("receivingTargets"), [4, 5, 6, 7, 8, 10, 12], "int"),
      ],
    },
    {
      key: "defense", label: "Defense",
      includes: (a) => !OFFENSE_POSITIONS.has(a.position) && ((a.stats["defensive.totalTackles"] ?? 0) > 0 || (a.stats["defensive.sacks"] ?? 0) > 0 || (a.stats["defensiveinterceptions.interceptions"] ?? 0) > 0),
      primary: "tackles", unit: nflUnit,
      columns: ["gp", "tackles", "sacks", "tfl", "pd", "defInt", "ff"],
      props: [
        prop("tackles", "Total tackles", "TCKL", gameValue("totalTackles"), [2, 3, 4, 5, 6, 8, 10], "int"),
        prop("soloTackles", "Solo tackles", "SOLO", gameValue("soloTackles"), [2, 3, 4, 5, 6], "int"),
        prop("sacks", "Sacks", "SACK", gameValue("sacks"), [0.5, 1, 2], "dec1"),
      ],
    },
  ],
  leaders: [
    { metric: "passYds", group: "passing", windowQualify: minGames(1) },
    { metric: "passTd", group: "passing", windowQualify: minGames(1) },
    { metric: "rushYds", group: "rushing", windowQualify: minGames(1) },
    { metric: "rushTd", group: "rushing", windowQualify: minGames(1) },
    { metric: "rec", group: "receiving", windowQualify: minGames(1) },
    { metric: "recYds", group: "receiving", windowQualify: minGames(1) },
    { metric: "sacks", group: "defense", windowQualify: minGames(1) },
    { metric: "defInt", group: "defense", windowQualify: minGames(1) },
  ],
  teamMetrics: [
    pointsForPerGame,
    pointsAgainstPerGame,
    { key: "yardsPerPlay", label: "Yards per play", short: "YPP", format: "dec2", direction: "desc", compute: (c) => nflYardsPerPlay(c, "own") },
    { key: "yardsPerPlayAllowed", label: "Yards per play allowed", short: "YPP-A", format: "dec2", direction: "asc", compute: (c) => nflYardsPerPlay(c, "opponent") },
    { key: "passYpg", label: "Net passing yards per game", short: "PASS/G", format: "dec1", direction: "desc", compute: teamStat("own", "passing.netPassingYardsPerGame") },
    { key: "rushYpg", label: "Rushing yards per game", short: "RUSH/G", format: "dec1", direction: "desc", compute: teamStat("own", "rushing.rushingYardsPerGame") },
    { key: "thirdDownPct", label: "Third-down conversion %", short: "3D%", format: "pct1", direction: "desc", compute: teamStat("own", "miscellaneous.thirdDownConvPct") },
    { key: "turnoverDiff", label: "Turnover differential", short: "TO +/-", format: "signed", direction: "desc", compute: teamStat("own", "miscellaneous.turnOverDifferential") },
  ],
  offenseMetric: "pointsForPerGame",
  defenseMetric: "pointsAgainstPerGame",
  unavailableMetrics: ["EPA per play", "DVOA"],
  conferenceLabel: "Conference",
  pointsLabel: "Points",
};

/* ---------------------------------- MLB ---------------------------------- */
const PITCHER_POSITIONS = new Set(["SP", "RP", "P", "CP"]);
const mlbMetrics = index([
  metric("g", "Games played", "G", "int", stat("batting.gamesPlayed"), countG),
  metric("ab", "At bats", "AB", "int", stat("batting.atBats"), sumG("atBats")),
  metric("r", "Runs", "R", "int", stat("batting.runs"), sumG("runs")),
  metric("h", "Hits", "H", "int", stat("batting.hits"), sumG("hits")),
  metric("hr", "Home runs", "HR", "int", stat("batting.homeRuns"), sumG("homeRuns")),
  metric("rbi", "Runs batted in", "RBI", "int", stat("batting.RBIs"), sumG("RBIs")),
  metric("bb", "Walks", "BB", "int", stat("batting.walks"), sumG("walks")),
  metric("so", "Strikeouts", "SO", "int", stat("batting.strikeouts"), sumG("strikeouts"), "asc"),
  metric("sb", "Stolen bases", "SB", "int", stat("batting.stolenBases"), sumG("stolenBases")),
  metric("avg", "Batting average", "AVG", "rate3", stat("batting.avg"), ratioG(["hits"], ["atBats"])),
  metric("obp", "On-base percentage", "OBP", "rate3", stat("batting.onBasePct"), onBase),
  metric("slg", "Slugging percentage", "SLG", "rate3", stat("batting.slugAvg"), slugging),
  metric("ops", "On-base plus slugging", "OPS", "rate3", stat("batting.OPS"), (games) => { const o = onBase(games); const s = slugging(games); return o === null || s === null ? null : o + s; }),
  metric("pg", "Games pitched", "G", "int", stat("pitching.gamesPlayed"), countG),
  metric("gs", "Games started", "GS", "int", stat("pitching.gamesStarted")),
  metric("w", "Wins", "W", "int", stat("pitching.wins"), sumG("wins")),
  metric("l", "Losses", "L", "int", stat("pitching.losses"), sumG("losses"), "asc"),
  metric("sv", "Saves", "SV", "int", stat("pitching.saves"), sumG("saves")),
  metric("ip", "Innings pitched", "IP", "innings", (s) => inningsToDecimal(s["pitching.innings"]), sumG("innings")),
  metric("k", "Strikeouts", "K", "int", stat("pitching.strikeouts"), sumG("strikeouts")),
  metric("pbb", "Walks allowed", "BB", "int", stat("pitching.walks"), sumG("walks"), "asc"),
  metric("era", "Earned run average", "ERA", "dec2", stat("pitching.ERA"), pitchingRate(["earnedRuns"], 9), "asc"),
  metric("whip", "Walks + hits per inning", "WHIP", "dec2", stat("pitching.WHIP"), pitchingRate(["walks", "hits"], 1), "asc"),
  metric("k9", "Strikeouts per 9 innings", "K/9", "dec1", stat("pitching.strikeoutsPerNineInnings"), pitchingRate(["strikeouts"], 9)),
]);
const mlb: LeagueDefinition = {
  league: "mlb",
  name: "MLB",
  metrics: mlbMetrics,
  groups: [
    {
      key: "batting", label: "Batting", includes: (a) => (a.stats["batting.atBats"] ?? 0) >= 10, primary: "hr", gameLogCategory: "batting", unit: always,
      columns: ["g", "ab", "r", "h", "hr", "rbi", "bb", "so", "sb", "avg", "obp", "slg", "ops"],
      props: [
        prop("hits", "Hits", "H", gameValue("hits"), [1, 2, 3], "int"),
        prop("totalBases", "Total bases", "TB", totalBases, [1, 2, 3, 4], "int"),
        prop("homeRuns", "Home runs", "HR", gameValue("homeRuns"), [1, 2], "int"),
        prop("rbis", "RBIs", "RBI", gameValue("RBIs"), [1, 2, 3], "int"),
        prop("runs", "Runs", "R", gameValue("runs"), [1, 2], "int"),
        prop("hrr", "Hits + runs + RBIs", "H+R+RBI", gameSum("hits", "runs", "RBIs"), [1, 2, 3, 4, 5], "int"),
      ],
    },
    {
      key: "pitching", label: "Pitching", includes: (a) => (inningsToDecimal(a.stats["pitching.innings"]) ?? 0) >= 5, primary: "k", gameLogCategory: "pitching",
      unit: (a) => a.position === "SP" ? "starts" : "appearances",
      columns: ["pg", "gs", "w", "l", "sv", "ip", "k", "pbb", "era", "whip", "k9"],
      props: [
        prop("strikeouts", "Strikeouts", "K", gameValue("strikeouts"), [3, 4, 5, 6, 7, 8, 9, 10], "int"),
        prop("innings", "Innings pitched", "IP", gameValue("innings"), [4, 5, 6, 7], "innings"),
        prop("earnedRuns", "Earned runs allowed", "ER", gameValue("earnedRuns"), [0, 1, 2, 3], "int", "under"),
        prop("hitsAllowed", "Hits allowed", "H", gameValue("hits"), [3, 4, 5, 6], "int", "under"),
        prop("walksAllowed", "Walks allowed", "BB", gameValue("walks"), [1, 2, 3], "int", "under"),
      ],
    },
  ],
  leaders: [
    { metric: "avg", group: "batting", qualify: hasTag("qualifiedBatting"), windowQualify: minTotal("atBats", 20) },
    { metric: "hr", group: "batting", windowQualify: minGames(3) },
    { metric: "rbi", group: "batting", windowQualify: minGames(3) },
    { metric: "r", group: "batting", windowQualify: minGames(3) },
    { metric: "h", group: "batting", windowQualify: minGames(3) },
    { metric: "ops", group: "batting", qualify: hasTag("qualifiedBatting"), windowQualify: minTotal("atBats", 20) },
    { metric: "era", group: "pitching", qualify: hasTag("qualifiedPitching"), windowQualify: minTotal("innings", 10) },
    { metric: "k", group: "pitching", windowQualify: minGames(1) },
  ],
  teamMetrics: [
    { ...pointsForPerGame, label: "Runs scored per game", short: "R/G", format: "dec2" },
    { ...pointsAgainstPerGame, label: "Runs allowed per game", short: "RA/G", format: "dec2" },
    { key: "ops", label: "Team OPS", short: "OPS", format: "rate3", direction: "desc", compute: teamStat("own", "batting.OPS") },
    { key: "avg", label: "Team batting average", short: "AVG", format: "rate3", direction: "desc", compute: teamStat("own", "batting.avg") },
    { key: "era", label: "Team ERA", short: "ERA", format: "dec2", direction: "asc", compute: teamStat("own", "pitching.ERA") },
    { key: "bullpenEra", label: "Bullpen ERA", short: "PEN ERA", format: "dec2", direction: "asc", compute: (c) => c.extras.bullpenEra ?? null },
    { key: "whip", label: "Team WHIP", short: "WHIP", format: "dec2", direction: "asc", compute: teamStat("own", "pitching.WHIP") },
    { key: "homeRuns", label: "Home runs", short: "HR", format: "int", direction: "desc", compute: teamStat("own", "batting.homeRuns") },
  ],
  offenseMetric: "pointsForPerGame",
  defenseMetric: "pointsAgainstPerGame",
  unavailableMetrics: [],
  conferenceLabel: "League",
  pointsLabel: "Runs",
};

/* ---------------------------------- NHL ---------------------------------- */
const nhlMetrics = index([
  metric("gp", "Games played", "GP", "int", stat("general.games"), countG),
  metric("g", "Goals", "G", "int", stat("offensive.goals"), sumG("goals")),
  metric("a", "Assists", "A", "int", stat("offensive.assists"), sumG("assists")),
  metric("pts", "Points", "PTS", "int", stat("offensive.points"), sumG("points")),
  metric("pm", "Plus/minus", "+/-", "signed", stat("general.plusMinus"), sumG("plusMinus")),
  metric("ppp", "Power play points", "PPP", "int", sumStats("offensive.powerPlayGoals", "offensive.powerPlayAssists"),
    (games) => games.length ? total(games, ["powerPlayGoals", "powerPlayAssists"]) : null),
  metric("sog", "Shots on goal", "SOG", "int", stat("offensive.shotsTotal"), sumG("shotsTotal")),
  metric("shPct", "Shooting percentage", "SH%", "pct1", stat("offensive.shootingPct"), ratioG(["goals"], ["shotsTotal"], 100)),
  metric("toi", "Time on ice per game", "TOI/G", "minutes", (s) => s["general.timeOnIcePerGame"] === null || s["general.timeOnIcePerGame"] === undefined ? null : s["general.timeOnIcePerGame"]! / 60, avgG("timeOnIcePerGame")),
  metric("pim", "Penalty minutes", "PIM", "int", stat("penalties.penaltyMinutes"), sumG("penaltyMinutes"), "asc"),
  metric("ggp", "Games played", "GP", "int", stat("general.games"), countG),
  metric("gw", "Wins", "W", "int", stat("general.wins"), sumG("wins")),
  metric("gl", "Losses", "L", "int", stat("general.losses"), sumG("losses"), "asc"),
  metric("otl", "Overtime losses", "OTL", "int", stat("defensive.overtimeLosses"), sumG("overtimeLosses"), "asc"),
  metric("gaa", "Goals against average", "GAA", "dec2", stat("defensive.avgGoalsAgainst"),
    (games) => { const minutes = total(games, ["timeOnIcePerGame"]); return minutes > 0 ? total(games, ["goalsAgainst"]) / minutes * 60 : null; }, "asc"),
  metric("svPct", "Save percentage", "SV%", "rate3", stat("defensive.savePct"), ratioG(["saves"], ["shotsAgainst"])),
  metric("sv", "Saves", "SV", "int", stat("defensive.saves"), sumG("saves")),
  metric("so", "Shutouts", "SO", "int", stat("defensive.shutouts"), sumG("shutouts")),
]);
const nhl: LeagueDefinition = {
  league: "nhl",
  name: "NHL",
  metrics: nhlMetrics,
  groups: [
    {
      key: "skaters", label: "Skaters", includes: (a) => a.position !== "G" && (a.stats["general.games"] ?? 0) > 0, primary: "pts", unit: always,
      columns: ["gp", "g", "a", "pts", "pm", "ppp", "sog", "shPct", "toi", "pim"],
      props: [
        prop("goals", "Goals", "G", gameValue("goals"), [1, 2], "int"),
        prop("assists", "Assists", "A", gameValue("assists"), [1, 2], "int"),
        prop("points", "Points", "PTS", gameValue("points"), [1, 2, 3], "int"),
        prop("shots", "Shots on goal", "SOG", gameValue("shotsTotal"), [2, 3, 4, 5, 6], "int"),
        prop("powerPlayPoints", "Power play points", "PPP", gameSum("powerPlayGoals", "powerPlayAssists"), [1, 2], "int"),
      ],
    },
    {
      key: "goalies", label: "Goalies", includes: (a) => a.position === "G" && (a.stats["general.games"] ?? 0) > 0, primary: "sv",
      unit: () => "starts",
      columns: ["ggp", "gw", "gl", "otl", "gaa", "svPct", "sv", "so"],
      props: [
        prop("saves", "Saves", "SV", gameValue("saves"), [18, 20, 22, 25, 28, 30, 35], "int"),
        prop("goalsAgainst", "Goals allowed", "GA", gameValue("goalsAgainst"), [1, 2, 3], "int", "under"),
      ],
    },
  ],
  leaders: [
    { metric: "g", group: "skaters", windowQualify: minGames(2) },
    { metric: "a", group: "skaters", windowQualify: minGames(2) },
    { metric: "pts", group: "skaters", windowQualify: minGames(2) },
    { metric: "ppp", group: "skaters", windowQualify: minGames(2) },
    { metric: "sv", group: "goalies", windowQualify: minGames(1) },
    { metric: "svPct", group: "goalies", qualify: hasTag("qualifiedGoalie"), windowQualify: minTotal("shotsAgainst", 60) },
    { metric: "gaa", group: "goalies", qualify: hasTag("qualifiedGoalie"), windowQualify: minGames(2) },
    { metric: "pm", group: "skaters", windowQualify: minGames(2) },
  ],
  teamMetrics: [
    { ...pointsForPerGame, label: "Goals per game", short: "GF/G", format: "dec2" },
    { ...pointsAgainstPerGame, label: "Goals against per game", short: "GA/G", format: "dec2" },
    { key: "powerPlayPct", label: "Power play %", short: "PP%", format: "pct1", direction: "desc", compute: teamStat("own", "offensive.powerPlayPct") },
    { key: "penaltyKillPct", label: "Penalty kill %", short: "PK%", format: "pct1", direction: "desc", compute: teamStat("own", "defensive.penaltyKillPct") },
    { key: "shotsPerGame", label: "Shots per game", short: "S/G", format: "dec1", direction: "desc", compute: (c) => perGame(c.stats?.own["offensive.shotsTotal"] ?? null, c.gamesPlayed) },
    { key: "savePct", label: "Team save %", short: "SV%", format: "rate3", direction: "desc", compute: teamStat("own", "defensive.savePct") },
  ],
  offenseMetric: "pointsForPerGame",
  defenseMetric: "pointsAgainstPerGame",
  unavailableMetrics: [],
  conferenceLabel: "Conference",
  pointsLabel: "Goals",
};

export const LEAGUE_DEFINITIONS: Record<League, LeagueDefinition> = { nba, nfl, mlb, nhl };

/** Picks the position group used for a player's profile, game log and props. */
export function primaryGroup(definition: LeagueDefinition, athlete: Pick<ProviderAthlete, "position" | "stats" | "tags" | "id">): PlayerGroupDef {
  const position = athlete.position;
  const find = (key: string) => definition.groups.find((group) => group.key === key)!;
  if (definition.league === "nfl") {
    if (position === "QB") return find("passing");
    if (position === "RB" || position === "FB") return find("rushing");
    if (position === "WR" || position === "TE") return find("receiving");
    if (!OFFENSE_POSITIONS.has(position)) return find("defense");
  }
  if (definition.league === "mlb") return PITCHER_POSITIONS.has(position) ? find("pitching") : find("batting");
  if (definition.league === "nhl") return position === "G" ? find("goalies") : find("skaters");
  const matching = definition.groups.filter((group) => group.includes(athlete as ProviderAthlete));
  return matching[0] ?? definition.groups[0]!;
}
