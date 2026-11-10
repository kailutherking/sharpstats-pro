import { normalizeInjury, normalizeStatus } from "../providers/espnInjuries";
import { classifyChange, filterInjuries, injuryLabel, practiceNotes, workloadNotes, type InjuryRow } from "./injury.service";
import { computeImpact, teamHealthScore, teamNameMatches, tierOf } from "./injuryImpact.service";
import type { PlayerRow } from "./stats.service";

const player = (id: string, values: Record<string, number>, position = "C", teamId = "7"): PlayerRow => ({
  id, name: `Player ${id}`, shortName: id, headshot: null, position, positionName: position, age: 28, status: "active", teamId, teamAbbr: "DEN", teamName: "Denver Nuggets", groups: [], tags: [], values,
});

describe("injury report", () => {
  it("normalizes provider statuses", () => {
    expect(normalizeStatus("Out", "out", "")).toBe("Out");
    expect(normalizeStatus("Injured Reserve", "Injured Reserve", "")).toBe("Injured Reserve");
    expect(normalizeStatus("suspension", "Suspension", "")).toBe("Suspended");
    expect(normalizeStatus("Day-To-Day", "day-to-day", "")).toBe("Day-to-Day");
    expect(normalizeStatus("Questionable", "questionable", "He is a game-time decision Sunday.")).toBe("Game Time Decision");
    expect(normalizeStatus("Active", "active", "")).toBe("Active");
  });

  it("normalizes an ESPN injury entry", () => {
    const row = normalizeInjury("nba", { id: "1", displayName: "Atlanta Hawks" }, {
      id: "538188", status: "Out", date: "2026-11-08T22:15Z", shortComment: "Ruled out Monday.", longComment: "Toe hyperextension.",
      type: { description: "out" }, details: { type: "Toe", location: "Leg", side: "Left", returnDate: "2026-11-13" },
      athlete: { displayName: "Asa Newell", position: { abbreviation: "F" }, team: { id: "1", abbreviation: "ATL", displayName: "Atlanta Hawks", name: "Hawks" }, links: [{ href: "https://www.espn.com/nba/player/_/id/4873201/asa-newell" }] },
    });
    expect(row).toMatchObject({ athleteId: "4873201", status: "Out", injuryType: "Toe", side: "Left", returnDate: "2026-11-13", teamNickname: "Hawks" });
    expect(injuryLabel(row!)).toBe("Left Toe");
  });

  it("classifies status changes for alerts", () => {
    expect(classifyChange("Questionable", "Out")).toBe("ruled_out");
    expect(classifyChange(null, "Out")).toBe("ruled_out");
    expect(classifyChange("Questionable", "Probable")).toBe("upgraded");
    expect(classifyChange("Questionable", "Doubtful")).toBe("downgraded");
    expect(classifyChange("Out", "Active")).toBe("returned");
    expect(classifyChange("Out", null)).toBe("returned");
    expect(classifyChange("Out", "Out")).toBeNull();
  });

  it("extracts practice participation and workload notes", () => {
    const practice = practiceNotes([{ text: "Smith was a limited participant in practice Wednesday. He did not practice Thursday.", at: "2026-11-06" }]);
    expect(practice.map((note) => note.level)).toEqual(["Limited", "Did not practice"]);
    expect(workloadNotes(["He will play on a minutes restriction tonight. Nothing else to report."])).toEqual(["He will play on a minutes restriction tonight."]);
  });

  it("rates an elite NBA absence near -8 points", () => {
    const star = player("1", { pts: 29, reb: 12.5, ast: 10, stl: 1.4, blk: 0.8, tov: 3, min: 36 });
    const teammate = player("2", { pts: 20, reb: 4, ast: 3, stl: 1, blk: 0.3, tov: 2 }, "G");
    const impact = computeImpact({ league: "nba", status: "Out", position: "C", row: star, teammates: [star, teammate], fantasyPool: [10, 20, 30, 40, 64], unavailable: new Set() });
    expect(impact.tier).toBe("Elite");
    expect(impact.ratingChange).toBeLessThan(-7.5);
    expect(impact.ratingChange).toBeGreaterThan(-9);
    expect(impact.prop.level).toBe("Very High");
    expect(impact.prop.beneficiaries[0]?.id).toBe("2");
    const questionable = computeImpact({ league: "nba", status: "Questionable", position: "C", row: star, teammates: [], fantasyPool: [], unavailable: new Set() });
    expect(questionable.projectedImpact).toBeLessThan(impact.projectedImpact);
  });

  it("does not rate MLB relievers with spot starts as starters", () => {
    const reliever = player("9", { pg: 40, gs: 4, ip: 50, era: 2.5, ab: 0, sv: 5 }, "RP");
    const impact = computeImpact({ league: "mlb", status: "Out", position: "RP", row: reliever, teammates: [], fantasyPool: [], unavailable: new Set() });
    expect(impact.importance).toBeLessThan(55);
  });

  it("scores team health and tiers", () => {
    expect(teamHealthScore([])).toBe(100);
    expect(teamHealthScore([{ importance: 90, weight: 1 }])).toBe(55);
    expect(tierOf(80)).toBe("Elite");
    expect(tierOf(10)).toBe("Minimal");
  });

  it("matches sportsbook team names", () => {
    expect(teamNameMatches("Boston Red Sox", "Red Sox", "Boston Red Sox")).toBe(true);
    expect(teamNameMatches("Chicago White Sox", "Red Sox", "Boston Red Sox")).toBe(false);
    expect(teamNameMatches("Los Angeles Clippers", "Clippers", "LA Clippers")).toBe(true);
  });

  it("filters the report and hides returning players by default", () => {
    const base = { teamId: "1", position: "G", name: "A", teamName: "T", teamAbbr: "T", injury: "Knee", reportedAt: new Date().toISOString() };
    const rows = [{ ...base, status: "Out" }, { ...base, status: "Active", name: "B" }, { ...base, status: "Questionable", position: "F", reportedAt: "2020-01-01T00:00:00Z" }] as InjuryRow[];
    expect(filterInjuries(rows, {}).length).toBe(2);
    expect(filterInjuries(rows, { status: ["Active"] }).length).toBe(1);
    expect(filterInjuries(rows, { updated: "24h" }).length).toBe(1);
    expect(filterInjuries(rows, { position: "F" }).length).toBe(1);
  });
});
