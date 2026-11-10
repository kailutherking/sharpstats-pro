import { boxValues, normalizeEvent, parseEspnOdds, periodLabel, statusOf } from "./espnLive";

describe("ESPN live adapter", () => {
  it("maps provider statuses", () => {
    expect(statusOf({ name: "STATUS_HALFTIME", state: "in" })).toBe("halftime");
    expect(statusOf({ name: "STATUS_END_PERIOD", state: "in" })).toBe("end_period");
    expect(statusOf({ name: "STATUS_IN_PROGRESS", state: "in" })).toBe("live");
    expect(statusOf({ name: "STATUS_FINAL", state: "post", completed: true })).toBe("final");
    expect(statusOf({ name: "STATUS_SCHEDULED", state: "pre" })).toBe("pregame");
    expect(statusOf({ name: "STATUS_POSTPONED", state: "post" })).toBe("postponed");
  });

  it("labels periods per league", () => {
    expect(periodLabel("nba", 2, "")).toBe("Q2");
    expect(periodLabel("nba", 5, "")).toBe("OT");
    expect(periodLabel("nhl", 3, "")).toBe("P3");
    expect(periodLabel("nhl", 5, "Shootout")).toBe("SO");
    expect(periodLabel("mlb", 7, "Bot 7th")).toBe("Bot 7th");
  });

  it("splits combined box score values", () => {
    const values = boxValues(["points", "fieldGoalsMade-fieldGoalsAttempted", "completions/passingAttempts", "fullInnings.partInnings", "plusMinus"], ["22", "8-16", "16/26", "5.2", "-3"]);
    expect(values).toMatchObject({ points: 22, fieldGoalsMade: 8, fieldGoalsAttempted: 16, completions: 16, passingAttempts: 26, outsRecorded: 17, plusMinus: -3 });
    expect(values.innings).toBeCloseTo(5.667, 2);
  });

  it("reads DraftKings opening and closing lines", () => {
    const odds = parseEspnOdds({
      provider: { name: "DraftKings" },
      moneyline: { home: { close: { odds: "+331" }, open: { odds: "+251" } }, away: { close: { odds: "-423" }, open: { odds: "-311" } } },
      pointSpread: { home: { close: { line: "+9.5", odds: "-113" }, open: { line: "+9.5", odds: "-110" } }, away: { close: { line: "-9.5", odds: "-107" }, open: { line: "-9.5", odds: "-110" } } },
      total: { over: { close: { line: "o238.5", odds: "-115" }, open: { line: "o238.5", odds: "-107" } }, under: { close: { line: "u238.5", odds: "-105" }, open: { line: "u238.5", odds: "-113" } } },
    });
    expect(odds.current?.moneyline).toEqual({ home: 331, away: -423 });
    expect(odds.current?.total).toEqual({ line: 238.5, over: -115, under: -105 });
    expect(odds.open?.moneyline?.home).toBe(251);
  });

  it("normalizes a live football event with situation", () => {
    const game = normalizeEvent("nfl", {
      id: "1", shortName: "BUF @ MIN",
      competitions: [{
        date: "2026-11-10T01:15Z",
        status: { period: 3, displayClock: "4:12", type: { name: "STATUS_IN_PROGRESS", state: "in", shortDetail: "4:12 - 3rd" } },
        situation: { possession: "2", down: 3, distance: 7, downDistanceText: "3rd & 7 at MIN 18", isRedZone: true, lastPlay: { text: "Pass complete", probability: { homeWinPercentage: 0.41 } } },
        competitors: [
          { homeAway: "home", score: "17", team: { id: "16", abbreviation: "MIN", displayName: "Minnesota Vikings" } },
          { homeAway: "away", score: "20", team: { id: "2", abbreviation: "BUF", displayName: "Buffalo Bills" } },
        ],
      }],
    });
    expect(game).toMatchObject({ status: "live", clock: "4:12", periodLabel: "Q3", homeWinProbability: 0.41 });
    expect(game?.situation).toMatchObject({ possessionTeamId: "2", down: 3, distance: 7, isRedZone: true });
    expect(game?.home.score).toBe(17);
  });

  it("hides pregame scores", () => {
    const game = normalizeEvent("nba", { id: "2", competitions: [{ status: { period: 0, type: { name: "STATUS_SCHEDULED", state: "pre" } }, competitors: [
      { homeAway: "home", score: "0", team: { id: "1" } }, { homeAway: "away", score: "0", team: { id: "2" } }] }] });
    expect(game?.home.score).toBeNull();
  });
});
