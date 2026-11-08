import { inningsToDecimal, normalizeAthletes, normalizeGameLog, normalizeStandings, normalizeTeamStats, toNumber } from "./espnStats";

describe("ESPN stats normalizers", () => {
  it("parses provider number formats", () => {
    expect(toNumber("2,246")).toBe(2246);
    expect(toNumber("-")).toBeNull();
    expect(toNumber(".312")).toBeCloseTo(0.312);
    expect(toNumber("+7")).toBe(7);
    expect(toNumber("23:40")).toBeCloseTo(23.6667, 3);
    expect(inningsToDecimal("6.1")).toBeCloseTo(6.3333, 3);
    expect(inningsToDecimal(174.2)).toBeCloseTo(174.6667, 3);
  });

  it("keys athlete stats by category", () => {
    const [athlete] = normalizeAthletes({
      categories: [{ name: "offensive", names: ["avgPoints", "assists"] }],
      athletes: [{
        athlete: { id: "1", displayName: "A Player", position: { abbreviation: "G" }, teamId: "13", teamShortName: "LAL", headshot: { href: "https://img" } },
        categories: [{ name: "offensive", values: [30.5, null] }],
      }],
    }, "qualified");
    expect(athlete).toMatchObject({ id: "1", position: "G", teamAbbr: "LAL", tags: ["qualified"] });
    expect(athlete!.stats).toEqual({ "offensive.avgPoints": 30.5, "offensive.assists": null });
  });

  it("walks conference and division standings", () => {
    const rows = normalizeStandings({
      children: [{
        name: "Eastern Conference", abbreviation: "East",
        children: [{
          name: "Atlantic",
          standings: { entries: [{ team: { id: "2", displayName: "Boston Celtics", abbreviation: "BOS" }, stats: [{ type: "wins", value: 9, displayValue: "9" }, { type: "home", displayValue: "5-1" }] }] },
        }],
      }],
    });
    expect(rows[0]).toMatchObject({ teamId: "2", conference: "Eastern Conference", division: "Atlantic" });
    expect(rows[0]!.stats.home!.display).toBe("5-1");
  });

  it("separates own and opponent team stats", () => {
    const stats = normalizeTeamStats({
      categories: [{ name: "offensive", names: ["avgPoints"] }],
      teams: [{ team: { id: "5" }, categories: [{ name: "offensive", displayName: "Own Offensive", values: [118] }, { name: "offensive", displayName: "Opponent Offensive", values: [110] }] }],
    });
    expect(stats.get("5")).toEqual({ own: { "offensive.avgPoints": 118 }, opponent: { "offensive.avgPoints": 110 } });
  });

  it("splits composite game-log columns and keeps regular-season games", () => {
    const log = normalizeGameLog({
      names: ["fieldGoalsMade-fieldGoalsAttempted", "points", "innings"],
      labels: ["FG", "PTS", "IP"],
      events: {
        a: { id: "a", gameDate: "2026-11-01T00:00:00Z", atVs: "@", opponent: { abbreviation: "NYK" }, gameResult: "W" },
        b: { id: "b", gameDate: "2026-11-03T00:00:00Z", atVs: "vs", opponent: { abbreviation: "MIA" }, gameResult: "L" },
        c: { id: "c", gameDate: "2026-10-01T00:00:00Z", atVs: "vs", opponent: { abbreviation: "ORL" } },
      },
      seasonTypes: [
        { displayName: "2026-27 Regular Season", categories: [{ events: [{ eventId: "a", stats: ["10-20", "30", "6.2"] }, { eventId: "b", stats: ["5-9", "12", "0.0"] }] }] },
        { displayName: "2026-27 Preseason", categories: [{ events: [{ eventId: "c", stats: ["1-2", "2", "1.0"] }] }] },
      ],
    });
    expect(log.games.map((game) => game.eventId)).toEqual(["b", "a"]);
    expect(log.games[1]).toMatchObject({ home: false, opponentAbbr: "NYK" });
    expect(log.games[1]!.values).toMatchObject({ fieldGoalsMade: 10, fieldGoalsAttempted: 20, points: 30 });
    expect(log.games[1]!.values.innings).toBeCloseTo(6.6667, 3);
  });
});
