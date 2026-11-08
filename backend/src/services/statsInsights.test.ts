import type { ProviderGame } from "../providers/espnStats";
import { buildPropMetrics, buildSplits, defaultLine, formatStat, generateInsights, generateTeamInsights, hitRate } from "./statsInsights";
import { LEAGUE_DEFINITIONS } from "./statsMetrics";
import { windowGames } from "./stats.service";

function game(index: number, values: Record<string, number>, home = index % 2 === 0, opponent = "BOS"): ProviderGame {
  return {
    eventId: String(1000 - index),
    date: new Date(Date.UTC(2026, 10, 7) - index * 2 * 86400000).toISOString(),
    week: null,
    home,
    opponentId: opponent,
    opponentAbbr: opponent,
    opponentName: opponent,
    opponentLogo: null,
    result: "W",
    score: "",
    values,
    display: {},
  };
}

const nbaProps = LEAGUE_DEFINITIONS.nba.groups[0]!.props;
// Most recent first: 8 of the last 10 games reach 25 points.
const points = [31, 28, 26, 22, 30, 27, 25, 19, 29, 26, 18, 20];
const games = points.map((value, index) => game(index, { points: value, totalRebounds: 5, assists: 4, threePointFieldGoalsMade: 2, steals: 1, blocks: 0 }));

describe("stats insight engine", () => {
  it("formats provider stat styles", () => {
    expect(formatStat(0.3125, "rate3")).toBe(".313");
    expect(formatStat(23.6667, "minutes")).toBe("23:40");
    expect(formatStat(174 + 2 / 3, "innings")).toBe("174.2");
    expect(formatStat(4, "signed")).toBe("+4");
    expect(formatStat(null, "dec1")).toBe("—");
  });

  it("counts over and under hit rates", () => {
    expect(hitRate([30, 20, null, 25], 25, "over")).toEqual({ hits: 2, games: 3 });
    expect(hitRate([0, 1, 3], 1, "under")).toEqual({ hits: 2, games: 3 });
  });

  it("anchors the default line to the recent median", () => {
    expect(defaultLine([10, 15, 20, 25, 30], 26.5)).toBe(25);
    expect(defaultLine([], 10)).toBeNull();
  });

  it("builds prop metrics from the most recent games", () => {
    const pointsMetric = buildPropMetrics(games, nbaProps).find((item) => item.key === "points")!;
    expect(pointsMetric.last5Avg).toBeCloseTo((31 + 28 + 26 + 22 + 30) / 5);
    expect(pointsMetric.hitRate.last10).toEqual({ hits: 8, games: 10 });
    expect(pointsMetric.streak).toBe(3);
    expect(pointsMetric.line).toBe(25);
  });

  it("writes hit-rate insights from game logs", () => {
    const insights = generateInsights("Test Player", "games", buildPropMetrics(games, nbaProps));
    const headlines = insights.map((item) => item.headline);
    expect(headlines).toContain("Test Player has recorded 25+ points in 8 of last 10 games.");
    expect(insights.filter((item) => item.stat === "points").length).toBeLessThanOrEqual(2);
  });

  it("phrases under props as allowed", () => {
    const pitching = LEAGUE_DEFINITIONS.mlb.groups.find((group) => group.key === "pitching")!.props;
    const starts = [1, 0, 2, 1, 0, 1, 2, 1, 4, 0].map((earnedRuns, index) => game(index, { earnedRuns, strikeouts: 6, innings: 6, hits: 4, walks: 1 }));
    const headlines = generateInsights("Ace", "starts", buildPropMetrics(starts, pitching)).map((item) => item.headline);
    expect(headlines.some((text) => /^Ace has allowed \d or fewer earned runs in \d+ of last 10 starts\.$/.test(text))).toBe(true);
  });

  it("splits home, away and opponent averages", () => {
    const splits = buildSplits([game(0, { points: 30 }, true, "NYK"), game(1, { points: 20 }, false, "NYK"), game(2, { points: 10 }, false, "MIA")], nbaProps);
    expect(splits.homeAway[0]).toMatchObject({ label: "Home", games: 1 });
    expect(splits.homeAway[1]!.averages.points).toBe(15);
    expect(splits.opponents[0]).toMatchObject({ label: "NYK", games: 2 });
  });

  it("filters game windows", () => {
    expect(windowGames(games, "last10")).toHaveLength(10);
    // Games are two days apart; 20 days after the latest game, only the six played in the
    // previous 10 days fall inside the 30-day window.
    const now = Date.parse(games[0]!.date) + 20 * 86400000;
    expect(windowGames(games, "last30", now)).toHaveLength(6);
    expect(windowGames(games, "season")).toHaveLength(games.length);
  });

  it("summarizes team form", () => {
    const teamGames = Array.from({ length: 10 }, (_, index) => ({ date: "", home: index % 2 === 0, pointsFor: 110 + index, pointsAgainst: 100, result: (index < 7 ? "W" : "L") as "W" | "L" }));
    const headlines = generateTeamInsights("Hawks", "Points", teamGames, 112, 104).map((item) => item.headline);
    expect(headlines).toContain("Hawks have won 7 of their last 10 games.");
    expect(headlines).toContain("Hawks have won 7 straight.");
  });
});
