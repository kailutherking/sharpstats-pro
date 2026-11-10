import { badgeProgress, levelFor, winStreaks, xpFrom, type BettingFacts } from "./gamification.service";
import { pickRecord, resultUnits } from "./pick.service";
import { slugify } from "./profile.service";
import { DEFAULT_PREFERENCES } from "./notification.service";
import { TOPIC_PATTERN } from "./realtime.service";

const facts = (overrides: Partial<BettingFacts> = {}): BettingFacts => ({
  bets: 0, settled: 0, wins: 0, staked: 0, profit: 0, longestWinStreak: 0, currentWinStreak: 0, closingTracked: 0, beatClosing: 0,
  propSettled: 0, propWins: 0, books: 0, hedgedPairs: 0, picks: 0, tailsReceived: 0, reactionsReceived: 0, commentsReceived: 0, visitDays: 0, bestVisitStreak: 0, ...overrides,
});

describe("gamification", () => {
  it("maps XP to levels and ranks", () => {
    expect(levelFor(0)).toMatchObject({ level: 1, rank: "Rookie", current: 0, next: 100 });
    expect(levelFor(100).level).toBe(2);
    expect(levelFor(299).level).toBe(2);
    expect(levelFor(300).level).toBe(3);
    expect(levelFor(50 * 10 * 9).rank).toBe("Pro");
    expect(levelFor(50 * 25 * 24).rank).toBe("Legend");
  });

  it("tracks win streaks, ignoring pushes", () => {
    expect(winStreaks(["win", "win", "push", "win", "loss", "win"])).toEqual({ longest: 3, current: 1 });
    expect(winStreaks([])).toEqual({ longest: 0, current: 0 });
  });

  it("awards badges only past their thresholds", () => {
    const earned = (input: Partial<BettingFacts>) => badgeProgress(facts(input)).filter((badge) => badge.earned).map((badge) => badge.key);
    expect(earned({})).toEqual([]);
    expect(earned({ longestWinStreak: 5 })).toEqual(["hot_streak"]);
    expect(earned({ settled: 30, staked: 1000, profit: 100 })).toContain("roi_king");
    expect(earned({ settled: 29, staked: 1000, profit: 300 })).not.toContain("roi_king");
    expect(earned({ closingTracked: 20, beatClosing: 12 })).toContain("sharp_bettor");
    expect(earned({ propSettled: 25, propWins: 13 })).not.toContain("prop_hunter");
    expect(earned({ propSettled: 25, propWins: 14 })).toContain("prop_hunter");
    expect(earned({ books: 5, hedgedPairs: 3, bets: 100, tailsReceived: 25, bestVisitStreak: 7, picks: 1 }).sort()).toEqual(["arbitrage_expert", "crowd_favorite", "first_pick", "grinder", "line_shopper", "on_a_roll"]);
  });

  it("computes XP from activity and badges", () => {
    expect(xpFrom(facts({ bets: 10, settled: 8, wins: 5, picks: 2, reactionsReceived: 3, commentsReceived: 1, visitDays: 4 }), 150)).toBe(50 + 40 + 50 + 20 + 6 + 2 + 20 + 150);
  });
});

describe("picks", () => {
  it("settles units at the shared odds", () => {
    expect(resultUnits("win", 2.1, 1.5)).toBe(1.65);
    expect(resultUnits("loss", 2.1, 1.5)).toBe(-1.5);
    expect(resultUnits("push", 2.1, 1.5)).toBe(0);
    expect(resultUnits("pending", 2.1, 1.5)).toBeNull();
  });

  it("builds a record with ROI on units risked", () => {
    const record = pickRecord([
      { result: "win", resultUnits: 1.82, units: 2, locked: true, autoGraded: true },
      { result: "loss", resultUnits: -1, units: 1 },
      { result: "push", resultUnits: 0, units: 1 },
      { result: "pending", resultUnits: null, units: 1 },
    ]);
    expect(record).toMatchObject({ picks: 4, settled: 3, wins: 1, losses: 1, pushes: 1, pending: 1, units: 0.82, risked: 3, verified: 1 });
    expect(record.roi).toBeCloseTo(0.2733, 3);
    expect(record.winRate).toBe(0.5);
  });
});

describe("profiles, notifications and realtime", () => {
  it("creates handles from display names", () => {
    expect(slugify("SharpStats Demo")).toBe("sharpstats_demo");
    expect(slugify("José Ñ")).toBe("jose_n");
    expect(slugify("A")).toBe("bettor_a");
  });

  it("turns every notification type on except general news", () => {
    expect(DEFAULT_PREFERENCES.prop_hit).toBe(true);
    expect(DEFAULT_PREFERENCES.news).toBe(false);
  });

  it("accepts only live game topics", () => {
    expect(TOPIC_PATTERN.test("game:nba:401909952")).toBe(true);
    expect(TOPIC_PATTERN.test("game:xfl:1")).toBe(false);
    expect(TOPIC_PATTERN.test("user:2")).toBe(false);
  });
});
