import {
  americanToDecimal, decimalToAmerican, evTier, expectedValue, kellyFraction, recommendedStake, removeVig, riskRating,
} from "./evCalculator.service";
import { aggregate, type SideSignals } from "./oddsAggregator.service";
import { arbitrageStakes } from "./arbitrage.service";
import { moveScore } from "./lineMovement.service";
import { buildPropRows, hitWindow, normalizeName, PROP_STATS, researchFromGames } from "./propResearch.service";
import type { OddsGame, RawQuote } from "./oddsTypes";
import type { ProviderGame } from "../providers/espnStats";

const noSignals = (): SideSignals => ({ steam: false, sharp: false, reverse: false, moves: 0, lastMoveAt: null });

const game: OddsGame = {
  id: "g1", sport: "nba", homeTeam: "Boston Celtics", awayTeam: "New York Knicks", homeAbbr: null, awayAbbr: null,
  homeLogo: null, awayLogo: null, commenceTime: "2026-11-09T00:00:00Z", status: "pregame", provider: "the-odds-api",
};

function q(partial: Partial<RawQuote> & Pick<RawQuote, "market" | "book" | "selection" | "american">): RawQuote {
  return {
    gameId: "g1", sport: "nba", participant: "", point: null, bookUpdatedAt: null,
    decimal: americanToDecimal(partial.american), ...partial,
  };
}

function run(quotes: RawQuote[], sharpBook: string | null = null) {
  return aggregate({ games: new Map([["g1", game]]), quotes, lineStates: new Map(), signals: noSignals, sharpBook });
}

describe("odds math", () => {
  it("converts between American and decimal odds", () => {
    expect(americanToDecimal(-110)).toBeCloseTo(1.9091, 4);
    expect(americanToDecimal(150)).toBe(2.5);
    expect(decimalToAmerican(2.5)).toBe(150);
    expect(decimalToAmerican(1.5)).toBe(-200);
  });

  it("removes the vig proportionally", () => {
    const fair = removeVig([americanToDecimal(-110), americanToDecimal(-110)])!;
    expect(fair[0]).toBeCloseTo(0.5, 6);
    expect(fair[0]! + fair[1]!).toBeCloseTo(1, 9);
    expect(removeVig([1.9])).toBeNull();
  });

  it("computes EV, Kelly, tiers and capped stakes", () => {
    expect(expectedValue(0.5, 2.1)).toBeCloseTo(0.05, 6);
    expect(kellyFraction(0.5, 2.1)).toBeCloseTo(0.0455, 3);
    expect(kellyFraction(0.4, 2)).toBe(0);
    expect(evTier(0.004)).toBeNull();
    expect(evTier(0.01)).toBe("positive");
    expect(evTier(0.035)).toBe("strong");
    expect(evTier(0.07)).toBe("elite");
    expect(recommendedStake(1000, 0.5)).toBe(50);
    expect(recommendedStake(1000, 0.04)).toBe(10);
    expect(riskRating({ ev: 0.2, decimal: 5, fairBooks: 2, isProp: true, sharpReference: false })).toBe("high");
    expect(riskRating({ ev: 0.02, decimal: 1.9, fairBooks: 6, isProp: false, sharpReference: false })).toBe("low");
  });

  it("sizes arbitrage stakes so every leg returns the same payout", () => {
    const stakes = arbitrageStakes({ legs: [
      { selectionId: "a", label: "A", book: "x", american: 110, decimal: 2.1, stakeShare: (1 / 2.1) / (1 / 2.1 + 1 / 2.05), updatedAt: "" },
      { selectionId: "b", label: "B", book: "y", american: 105, decimal: 2.05, stakeShare: (1 / 2.05) / (1 / 2.1 + 1 / 2.05), updatedAt: "" },
    ] }, 100);
    expect(stakes[0]!.stake + stakes[1]!.stake).toBeCloseTo(100, 1);
    expect(Math.abs(stakes[0]!.payout - stakes[1]!.payout)).toBeLessThan(0.05);
  });
});

describe("market aggregation", () => {
  const moneyline = [
    q({ market: "h2h", book: "draftkings", selection: "Boston Celtics", american: -150 }),
    q({ market: "h2h", book: "draftkings", selection: "New York Knicks", american: 130 }),
    q({ market: "h2h", book: "fanduel", selection: "Boston Celtics", american: -145 }),
    q({ market: "h2h", book: "fanduel", selection: "New York Knicks", american: 125 }),
    q({ market: "h2h", book: "betmgm", selection: "Boston Celtics", american: -155 }),
    q({ market: "h2h", book: "betmgm", selection: "New York Knicks", american: 145 }),
  ];

  it("finds best price, market average and consensus no-vig fair odds", () => {
    const { selections } = run(moneyline);
    const knicks = selections.find((selection) => selection.selection === "New York Knicks")!;
    expect(knicks.best).toMatchObject({ book: "betmgm", american: 145 });
    expect(knicks.fair?.source).toBe("consensus");
    expect(knicks.fair?.books).toBe(3);
    expect(knicks.fair!.probability).toBeGreaterThan(0.4);
    expect(knicks.fair!.probability).toBeLessThan(0.45);
    expect(knicks.ev).toBeGreaterThan(0);
    expect(knicks.tier).not.toBeNull();
    expect(knicks.books.find((price) => price.book === "betmgm")?.isBest).toBe(true);
  });

  it("prefers the sharp reference book for fair odds", () => {
    const { selections } = run([
      ...moneyline,
      q({ market: "h2h", book: "pinnacle", selection: "Boston Celtics", american: -160 }),
      q({ market: "h2h", book: "pinnacle", selection: "New York Knicks", american: 148 }),
    ], "pinnacle");
    const knicks = selections.find((selection) => selection.selection === "New York Knicks")!;
    expect(knicks.fair?.source).toBe("sharp");
    expect(knicks.fair?.sourceLabel).toContain("Pinnacle");
    // The reference book never counts as the best bettable price.
    expect(knicks.best?.book).toBe("betmgm");
  });

  it("detects arbitrage across books and sizes the legs", () => {
    const { arbitrage, selections } = run([
      q({ market: "h2h", book: "draftkings", selection: "Boston Celtics", american: 110 }),
      q({ market: "h2h", book: "draftkings", selection: "New York Knicks", american: -130 }),
      q({ market: "h2h", book: "fanduel", selection: "Boston Celtics", american: -125 }),
      q({ market: "h2h", book: "fanduel", selection: "New York Knicks", american: 112 }),
    ]);
    expect(arbitrage).toHaveLength(1);
    expect(arbitrage[0]!.profitPct).toBeGreaterThan(0.04);
    expect(new Set(arbitrage[0]!.books)).toEqual(new Set(["draftkings", "fanduel"]));
    expect(arbitrage[0]!.legs.reduce((sum, leg) => sum + leg.stakeShare, 0)).toBeCloseTo(1, 9);
    expect(selections.every((selection) => selection.arbitrage !== null)).toBe(true);
  });

  it("pairs spreads from the home perspective and flags books off the main number", () => {
    const { selections } = run([
      q({ market: "spreads", book: "draftkings", selection: "Boston Celtics", point: -4.5, american: -110 }),
      q({ market: "spreads", book: "draftkings", selection: "New York Knicks", point: 4.5, american: -110 }),
      q({ market: "spreads", book: "fanduel", selection: "Boston Celtics", point: -4.5, american: -108 }),
      q({ market: "spreads", book: "fanduel", selection: "New York Knicks", point: 4.5, american: -112 }),
      q({ market: "spreads", book: "betmgm", selection: "Boston Celtics", point: -5, american: -105 }),
      q({ market: "spreads", book: "betmgm", selection: "New York Knicks", point: 5, american: -115 }),
    ]);
    const celtics = selections.find((selection) => selection.selection === "Boston Celtics")!;
    expect(celtics.point).toBe(-4.5);
    expect(celtics.label).toBe("Boston Celtics -4.5");
    expect(celtics.books.find((price) => price.book === "betmgm")?.atLine).toBe(false);
    expect(celtics.best?.book).toBe("fanduel");
    expect(celtics.fair?.books).toBe(2);
  });

  it("keeps pick'em (DFS) lines out of pricing math", () => {
    const { selections } = run([
      q({ market: "player_points", book: "draftkings", selection: "Over", participant: "Jalen Brunson", point: 26.5, american: -115 }),
      q({ market: "player_points", book: "draftkings", selection: "Under", participant: "Jalen Brunson", point: 26.5, american: -105 }),
      q({ market: "player_points", book: "prizepicks", selection: "Over", participant: "Jalen Brunson", point: 25.5, american: -137 }),
      q({ market: "player_points", book: "prizepicks", selection: "Under", participant: "Jalen Brunson", point: 25.5, american: -137 }),
    ]);
    const over = selections.find((selection) => selection.selection === "Over")!;
    expect(over.point).toBe(26.5);
    expect(over.label).toBe("Jalen Brunson Over 26.5");
    expect(over.best?.book).toBe("draftkings");
    expect(over.books.find((price) => price.book === "prizepicks")?.priced).toBe(false);
    // One priced book is not enough for a trusted fair price.
    expect(over.ev).toBeNull();
  });
});

describe("line movement", () => {
  it("scores moves from each side's perspective", () => {
    expect(moveScore({ sport: "nba", market: "h2h", selection: "Boston Celtics" }, { american: -110, point: null }, { american: -130, point: null })).toBeGreaterThan(0);
    expect(moveScore({ sport: "nba", market: "spreads", selection: "Boston Celtics" }, { american: -110, point: -3.5 }, { american: -110, point: -4.5 })).toBeCloseTo(0.03, 6);
    expect(moveScore({ sport: "nba", market: "totals", selection: "Under" }, { american: -110, point: 221.5 }, { american: -110, point: 223.5 })).toBeLessThan(0);
  });
});

describe("prop research", () => {
  const log = (values: number[], homes: boolean[], opponents: string[]): ProviderGame[] => values.map((points, index) => ({
    eventId: String(index), date: `2026-11-${String(20 - index).padStart(2, "0")}`, week: null, home: homes[index]!, opponentId: "",
    opponentAbbr: opponents[index]!, opponentName: "", opponentLogo: null, result: "W", score: "", values: { points, totalRebounds: 5, assists: 7 }, display: {},
  }));

  it("normalizes player names across providers", () => {
    expect(normalizeName("Luka Dončić")).toBe("luka doncic");
    expect(normalizeName("Jaren Jackson Jr.")).toBe("jaren jackson");
    expect(normalizeName("D'Angelo Russell")).toBe("d angelo russell");
  });

  it("computes hit rates by window, venue and opponent", () => {
    const games = log([30, 22, 28, 31, 19, 27, 26, 24, 33, 21, 29], [true, false, true, false, true, false, true, false, true, false, true], ["BOS", "MIA", "BOS", "NYK", "MIA", "BOS", "PHI", "NYK", "BOS", "MIA", "PHI"]);
    const research = researchFromGames(games, PROP_STATS["nba.points"]!, 25.5, "BOS");
    expect(research.l5).toEqual({ hits: 3, games: 5, rate: 0.6 });
    expect(research.l10.games).toBe(10);
    expect(research.season.hits).toBe(7);
    expect(research.home.games).toBe(6);
    expect(research.vsOpponent).toEqual({ hits: 4, games: 4, rate: 1 });
    expect(research.averageL10).toBe(26.1);
    expect(hitWindow([], 1).rate).toBeNull();
  });

  it("derives combined and milestone prop stats", () => {
    expect(PROP_STATS["nba.pra"]!({ points: 20, totalRebounds: 8, assists: 6 })).toBe(34);
    expect(PROP_STATS["nba.doubleDouble"]!({ points: 20, totalRebounds: 11, assists: 4, steals: 1, blocks: 0 })).toBe(1);
    expect(PROP_STATS["mlb.totalBases"]!({ hits: 2, doubles: 1, triples: 0, homeRuns: 1 })).toBe(6);
    expect(PROP_STATS["mlb.outs"]!({ innings: 5.333333 })).toBe(16);
    expect(PROP_STATS["nfl.anytimeTd"]!({ rushingTouchdowns: 0, receivingTouchdowns: 1 })).toBe(1);
  });

  it("groups Over/Under selections into one prop row", () => {
    const { selections } = run([
      q({ market: "player_points", book: "draftkings", selection: "Over", participant: "Jayson Tatum", point: 27.5, american: -110 }),
      q({ market: "player_points", book: "draftkings", selection: "Under", participant: "Jayson Tatum", point: 27.5, american: -110 }),
      q({ market: "player_points", book: "fanduel", selection: "Over", participant: "Jayson Tatum", point: 27.5, american: -105 }),
      q({ market: "player_points", book: "fanduel", selection: "Under", participant: "Jayson Tatum", point: 27.5, american: -115 }),
    ]);
    const rows = buildPropRows(selections, new Map([["g1", game]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ player: "Jayson Tatum", line: 27.5, marketLabel: "Points", game: "New York Knicks @ Boston Celtics" });
    expect(rows[0]!.over?.best?.book).toBe("fanduel");
    expect(rows[0]!.under?.best?.book).toBe("draftkings");
  });
});
