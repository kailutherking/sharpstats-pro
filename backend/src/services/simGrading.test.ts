import {
  canonicalTeam, clvPct, evPct, gradeGameLeg, gradePropLeg, periodScore, settleWager, teamSimilarity, toAmerican, BASKETBALL_PROP_STATS, type FinalScore, type GradableLeg,
} from "./simGrading";
import { gameMatchScore } from "./simBetting.service";

jest.mock("../db/pool", () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

const score: FinalScore = { home: 84, away: 74, homeLines: [40, 44], awayLines: [38, 36] };
const leg = (overrides: Partial<GradableLeg>): GradableLeg => ({
  sport: "ncaab", marketKey: "spreads", marketType: "spread", period: "game", selection: "Ohio St Buckeyes", participant: "", point: -9.5,
  homeTeam: "Ohio St Buckeyes", awayTeam: "Marshall Thundering Herd", ...overrides,
});

describe("simulated wager grading", () => {
  it("grades spreads, including pushes and the road side", () => {
    expect(gradeGameLeg(leg({}), score)).toMatchObject({ status: "won", note: "74-84" });
    expect(gradeGameLeg(leg({ point: -10 }), score)?.status).toBe("push");
    expect(gradeGameLeg(leg({ point: -10.5 }), score)?.status).toBe("lost");
    expect(gradeGameLeg(leg({ selection: "Marshall Thundering Herd", point: 10.5 }), score)?.status).toBe("won");
  });

  it("grades moneylines, totals and team totals", () => {
    expect(gradeGameLeg(leg({ marketType: "moneyline", point: null }), score)?.status).toBe("won");
    expect(gradeGameLeg(leg({ marketType: "moneyline", selection: "Marshall Thundering Herd", point: null }), score)?.status).toBe("lost");
    expect(gradeGameLeg(leg({ marketType: "total", selection: "Over", point: 157.5 }), score)).toMatchObject({ status: "won", value: 158 });
    expect(gradeGameLeg(leg({ marketType: "total", selection: "Under", point: 158 }), score)?.status).toBe("push");
    expect(gradeGameLeg(leg({ marketType: "team_total", selection: "Under", participant: "Marshall Thundering Herd", point: 74.5 }), score)?.status).toBe("won");
  });

  it("uses halves for college and includes overtime in the second half", () => {
    expect(periodScore("ncaab", "1h", score)).toEqual({ home: 40, away: 38 });
    expect(periodScore("ncaab", "2h", { ...score, homeLines: [40, 30, 14], awayLines: [38, 32, 4] })).toEqual({ home: 44, away: 36 });
    expect(periodScore("nba", "1h", { home: 100, away: 90, homeLines: [25, 25, 25, 25], awayLines: [20, 20, 25, 25] })).toEqual({ home: 50, away: 40 });
    expect(gradeGameLeg(leg({ period: "1h", marketKey: "spreads_h1", point: -2.5 }), score)?.status).toBe("lost");
    expect(gradeGameLeg(leg({ period: "1h" }), { ...score, homeLines: [], awayLines: [] })).toBeNull();
  });

  it("grades player props and voids players who did not play", () => {
    const box = { points: 22, rebounds: 11, assists: 4, threePointFieldGoalsMade: 3, steals: 1, blocks: 0 };
    expect(gradePropLeg({ marketType: "prop_ou", selection: "Over", point: 20.5 }, BASKETBALL_PROP_STATS.player_points!(box), true)?.status).toBe("won");
    expect(gradePropLeg({ marketType: "prop_ou", selection: "Under", point: 36.5 }, BASKETBALL_PROP_STATS.player_points_rebounds_assists!(box), true)?.status).toBe("lost");
    expect(gradePropLeg({ marketType: "prop_yes", selection: "Yes", point: null }, BASKETBALL_PROP_STATS.player_double_double!(box), true)?.status).toBe("won");
    expect(gradePropLeg({ marketType: "prop_ou", selection: "Over", point: 20.5 }, null, false)).toMatchObject({ status: "void" });
  });

  it("settles singles and parlays the way a sportsbook does", () => {
    expect(settleWager(25, [{ status: "won", decimal: 1.87 }])).toMatchObject({ status: "won", payout: 46.75, profitLoss: 21.75 });
    expect(settleWager(25, [{ status: "push", decimal: 1.87 }])).toMatchObject({ status: "push", payout: 25, profitLoss: 0 });
    // One loss ends the parlay even while other legs are open.
    expect(settleWager(10, [{ status: "lost", decimal: 2 }, { status: "open", decimal: 2 }])).toMatchObject({ status: "lost", payout: 0, profitLoss: -10 });
    expect(settleWager(10, [{ status: "won", decimal: 2 }, { status: "open", decimal: 2 }])).toBeNull();
    // A pushed or voided leg drops out and the parlay pays at the reduced price.
    expect(settleWager(10, [{ status: "won", decimal: 2 }, { status: "push", decimal: 1.9 }, { status: "won", decimal: 1.5 }])).toMatchObject({ status: "won", payout: 30, decimal: 3 });
    expect(settleWager(10, [{ status: "void", decimal: 2 }, { status: "void", decimal: 2 }])).toMatchObject({ status: "void", payout: 10 });
  });

  it("converts prices and measures CLV and EV", () => {
    expect(toAmerican(2.5)).toBe(150);
    expect(toAmerican(1.5)).toBe(-200);
    expect(clvPct(2.1, 2)).toBeCloseTo(5);
    expect(clvPct(2.1, null)).toBeNull();
    expect(evPct(0.55, 2)).toBeCloseTo(10);
  });

  it("matches college team spellings across providers", () => {
    expect(canonicalTeam("Florida St Seminoles")).toBe(canonicalTeam("Florida State Seminoles"));
    expect(canonicalTeam("St. John's Red Storm")).toBe(canonicalTeam("Saint John's Red Storm"));
    expect(canonicalTeam("Miami (OH) RedHawks")).toBe("miamiredhawks");
    expect(teamSimilarity("Texas A&M-CC Islanders", "Texas A&M-Corpus Christi Islanders")).toBeGreaterThan(0.5);
    const start = Date.parse("2026-11-09T23:00:00Z");
    expect(gameMatchScore({ home: "Ohio St Buckeyes", away: "Marshall Thundering Herd", start }, { home: "Ohio State Buckeyes", away: "Marshall Thundering Herd", start })).toBe(3);
    expect(gameMatchScore({ home: "Texas A&M-CC Islanders", away: "Rice Owls", start }, { home: "Texas A&M-Corpus Christi Islanders", away: "Rice Owls", start: start + 60_000 })).toBe(2);
    expect(gameMatchScore({ home: "Duke Blue Devils", away: "Rice Owls", start }, { home: "Kansas Jayhawks", away: "Iowa Hawkeyes", start })).toBe(0);
  });
});
