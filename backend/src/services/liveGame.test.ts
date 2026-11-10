import { clockMinutes, gameProgress, matchOddsGame, overProbability, projectStat, summarizeLines } from "./liveGame.service";
import type { LiveSituation } from "../providers/espnLive";

const situation = { outs: 1 } as LiveSituation;

describe("live game tracker math", () => {
  it("parses clocks, including the NBA's final-minute seconds", () => {
    expect(clockMinutes("5:30")).toBeCloseTo(5.5);
    expect(clockMinutes("45.2")).toBeCloseTo(0.753, 2);
  });

  it("measures game progress per league", () => {
    expect(gameProgress({ league: "nba", status: "live", period: 3, clock: "6:00", statusDetail: "", situation })).toBeCloseTo(30 / 48);
    expect(gameProgress({ league: "nba", status: "halftime", period: 2, clock: "0.0", statusDetail: "Halftime", situation })).toBeCloseTo(0.5);
    expect(gameProgress({ league: "nfl", status: "live", period: 4, clock: "15:00", statusDetail: "", situation })).toBeCloseTo(0.75);
    expect(gameProgress({ league: "mlb", status: "live", period: 5, clock: null, statusDetail: "Bot 5th", situation })).toBeCloseTo((9 + 1 / 3) / 18);
    expect(gameProgress({ league: "nhl", status: "final", period: 3, clock: null, statusDetail: "Final", situation })).toBe(1);
  });

  it("projects a finish from season rate and tonight's pace", () => {
    // 22 points in 24 of a 35-minute season average at halftime.
    const projection = projectStat({ current: 22, seasonAverage: 27, progress: 0.5, minutesPlayed: 18, seasonMinutes: 35 });
    expect(projection.projected).toBeGreaterThan(31);
    expect(projection.projected).toBeLessThan(42);
    expect(projectStat({ current: 3, seasonAverage: null, progress: 0.5 }).projected).toBeCloseTo(6);
    expect(projectStat({ current: 5, seasonAverage: 8, progress: 1, final: true }).projected).toBe(5);
  });

  it("estimates the chance to clear a line", () => {
    expect(overProbability(28, 27.5, 5, 2.3)).toBe(1);
    expect(overProbability(10, 27.5, 0, 2.3)).toBe(0);
    const likely = overProbability(22, 27.5, 9, 2.3);
    const unlikely = overProbability(22, 27.5, 2, 2.3);
    expect(likely).toBeGreaterThan(0.6);
    expect(unlikely).toBeLessThan(0.15);
    expect(overProbability(0, 0.5, 1, 1)).toBeCloseTo(1 - Math.exp(-1), 3);
  });

  it("matches odds games by team nickname and time", () => {
    const espn = { id: "401", startTime: "2026-11-10T00:00:00Z", home: { name: "LA Clippers", shortName: "Clippers" }, away: { name: "Boston Celtics", shortName: "Celtics" } } as never;
    const games = [{ id: "abc", homeTeam: "Los Angeles Clippers", awayTeam: "Boston Celtics", commenceTime: "2026-11-10T00:10:00Z" }] as never;
    expect(matchOddsGame(espn, games)?.id).toBe("abc");
  });

  it("falls back to the ESPN DraftKings line with a no-vig probability", () => {
    const summary = summarizeLines(null, [], { provider: "DraftKings", spread: null, total: null, moneyline: { home: -150, away: 130 } }, null);
    expect(summary.source).toBe("espn");
    expect(summary.marketHomeProbability).toBeGreaterThan(0.55);
    expect(summary.marketHomeProbability).toBeLessThan(0.6);
  });
});
