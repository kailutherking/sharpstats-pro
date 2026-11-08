import { americanToDecimal, confidenceRating } from "./evCalculator.service";
import { aggregate, lineId, reverseLineSide, type LineState, type SideSignals } from "./oddsAggregator.service";
import { providerMode, providerSetting, providerStatus } from "./odds.service";
import { parseMigrationFile } from "../db/migrate";
import { buildAlerts } from "./oddsAlerts.service";
import type { OddsGame, RawQuote } from "./oddsTypes";

const noSignals = (): SideSignals => ({ steam: false, sharp: false, reverse: false, moves: 0, lastMoveAt: null });

const game: OddsGame = {
  id: "g1", sport: "nba", homeTeam: "Boston Celtics", awayTeam: "New York Knicks", homeAbbr: null, awayAbbr: null,
  homeLogo: null, awayLogo: null, commenceTime: "2026-11-09T00:00:00Z", status: "pregame", provider: "the-odds-api",
};

function q(partial: Partial<RawQuote> & Pick<RawQuote, "market" | "book" | "selection" | "american">): RawQuote {
  return { gameId: "g1", sport: "nba", participant: "", point: null, bookUpdatedAt: null, decimal: americanToDecimal(partial.american), ...partial };
}

function opened(quote: RawQuote, openAmerican: number, openPoint: number | null = quote.point): [string, LineState] {
  return [lineId(quote, "game"), {
    openAmerican, openPoint, openAt: "2026-11-08T12:00:00Z", prevAmerican: openAmerican, prevPoint: openPoint,
    highAmerican: Math.max(openAmerican, quote.american), lowAmerican: Math.min(openAmerican, quote.american),
    highPoint: openPoint, lowPoint: openPoint, lastChangeAt: "2026-11-08T15:00:00Z", lastSeenAt: "2026-11-08T15:00:00Z",
  }];
}

function run(quotes: RawQuote[], states: Array<[string, LineState]>) {
  return aggregate({ games: new Map([["g1", game]]), quotes, lineStates: new Map(states), signals: noSignals, sharpBook: null });
}

describe("confidence rating", () => {
  it("rates a sharp-referenced, widely priced edge highly", () => {
    const rating = confidenceRating({ ev: 0.03, decimal: 1.95, fairBooks: 6, sharpReference: true, isProp: false, booksAtLine: 7, priceAgeSeconds: 60 });
    expect(rating.label).toBe("high");
    expect(rating.score).toBeGreaterThanOrEqual(70);
  });

  it("marks thin, long-odds, stale prop edges as low confidence", () => {
    const rating = confidenceRating({ ev: 0.2, decimal: 5, fairBooks: 2, sharpReference: false, isProp: true, booksAtLine: 2, priceAgeSeconds: 7200 });
    expect(rating.label).toBe("low");
    expect(rating.reasons).toEqual(expect.arrayContaining(["Player prop", "Long odds", "Price not updated for over an hour"]));
    expect(rating.score).toBeGreaterThanOrEqual(0);
  });
});

describe("best and worst price", () => {
  it("reports the worst comparable price alongside the best", () => {
    const { selections } = run([
      q({ market: "h2h", book: "draftkings", selection: "Boston Celtics", american: -150 }),
      q({ market: "h2h", book: "fanduel", selection: "Boston Celtics", american: -140 }),
      q({ market: "h2h", book: "betmgm", selection: "Boston Celtics", american: -160 }),
      q({ market: "h2h", book: "draftkings", selection: "New York Knicks", american: 130 }),
      q({ market: "h2h", book: "fanduel", selection: "New York Knicks", american: 120 }),
      q({ market: "h2h", book: "betmgm", selection: "New York Knicks", american: 135 }),
    ], []);
    const celtics = selections.find((selection) => selection.selection === "Boston Celtics")!;
    expect(celtics.best).toMatchObject({ book: "fanduel", american: -140 });
    expect(celtics.worst).toMatchObject({ book: "betmgm", american: -160 });
    expect(celtics.confidence).not.toBeNull();
  });
});

describe("reverse line movement (estimated)", () => {
  it("flags a moneyline underdog the market moved toward", () => {
    const quotes = [
      q({ market: "h2h", book: "draftkings", selection: "Boston Celtics", american: -145 }),
      q({ market: "h2h", book: "fanduel", selection: "Boston Celtics", american: -142 }),
      q({ market: "h2h", book: "draftkings", selection: "New York Knicks", american: 120 }),
      q({ market: "h2h", book: "fanduel", selection: "New York Knicks", american: 122 }),
    ];
    const { selections } = run(quotes, [opened(quotes[0]!, -180), opened(quotes[1]!, -175), opened(quotes[2]!, 150), opened(quotes[3]!, 148)]);
    expect(selections.find((selection) => selection.selection === "New York Knicks")!.signals.reverse).toBe(true);
    expect(selections.find((selection) => selection.selection === "Boston Celtics")!.signals.reverse).toBe(false);
  });

  it("flags a total moving down (toward the under)", () => {
    const quotes = [
      q({ market: "totals", book: "draftkings", selection: "Over", american: -110, point: 221.5 }),
      q({ market: "totals", book: "draftkings", selection: "Under", american: -110, point: 221.5 }),
    ];
    const { selections } = run(quotes, [opened(quotes[0]!, -110, 224.5), opened(quotes[1]!, -110, 224.5)]);
    expect(selections.find((selection) => selection.selection === "Under")!.signals.reverse).toBe(true);
  });

  it("does not flag a move toward the favorite or a move without history", () => {
    const quotes = [
      q({ market: "spreads", book: "draftkings", selection: "Boston Celtics", american: -110, point: -7 }),
      q({ market: "spreads", book: "draftkings", selection: "New York Knicks", american: -110, point: 7 }),
    ];
    const toFavorite = run(quotes, [opened(quotes[0]!, -110, -5.5), opened(quotes[1]!, -110, 5.5)]);
    expect(toFavorite.selections.some((selection) => selection.signals.reverse)).toBe(false);
    expect(reverseLineSide(run(quotes, []).selections)).toBeNull();
  });
});

describe("ODDS_PROVIDER", () => {
  it("normalises provider names", () => {
    expect(providerSetting("theoddsapi")).toBe("theoddsapi");
    expect(providerSetting("The-Odds-API")).toBe("theoddsapi");
    expect(providerSetting("espn")).toBe("espn");
    expect(providerSetting(undefined)).toBe("auto");
    expect(providerSetting("unknown")).toBe("auto");
  });

  it("falls back to ESPN with a warning when theoddsapi has no key, and honours espn", () => {
    const saved = { provider: process.env.ODDS_PROVIDER, key: process.env.ODDS_API_KEY };
    try {
      process.env.ODDS_PROVIDER = "theoddsapi";
      delete process.env.ODDS_API_KEY;
      expect(providerMode()).toBe("espn");
      expect(providerStatus("nba").warning).toMatch(/ODDS_API_KEY is empty/);
      process.env.ODDS_API_KEY = "test-key";
      expect(providerMode()).toBe("the-odds-api");
      expect(providerStatus("nba").warning).toBeNull();
      process.env.ODDS_PROVIDER = "espn";
      expect(providerMode()).toBe("espn");
      expect(providerStatus("nba").warning).toMatch(/ignored/);
    } finally {
      if (saved.provider === undefined) delete process.env.ODDS_PROVIDER; else process.env.ODDS_PROVIDER = saved.provider;
      if (saved.key === undefined) delete process.env.ODDS_API_KEY; else process.env.ODDS_API_KEY = saved.key;
    }
  });
});

describe("migrations", () => {
  it("parses numbered migration files and checksums them", () => {
    const migration = parseMigrationFile("001_odds_selection_history.sql", "SELECT 1;");
    expect(migration).toMatchObject({ version: "001", name: "odds_selection_history" });
    expect(migration!.checksum).toHaveLength(64);
    expect(parseMigrationFile("add-thing.sql", "")).toBeNull();
  });
});

describe("live games", () => {
  const quotes = [
    q({ market: "h2h", book: "pinnacle", selection: "Boston Celtics", american: -150 }),
    q({ market: "h2h", book: "pinnacle", selection: "New York Knicks", american: 135 }),
    q({ market: "h2h", book: "draftkings", selection: "Boston Celtics", american: -110 }),
    q({ market: "h2h", book: "draftkings", selection: "New York Knicks", american: 100 }),
  ];
  const signals = (): SideSignals => ({ steam: true, sharp: true, reverse: false, moves: 4, lastMoveAt: "2026-11-08T19:00:00Z" });
  const build = (status: OddsGame["status"]) => {
    const games = new Map([["g1", { ...game, status }]]);
    const { selections } = aggregate({ games, quotes, lineStates: new Map(), signals, sharpBook: "pinnacle" });
    const celtics = selections.find((selection) => selection.selection === "Boston Celtics")!;
    const alerts = buildAlerts({
      sport: "nba", games, selections, moves: [], openedArbitrage: [],
      openedEv: new Set([`${celtics.id}|draftkings|-110`]),
    });
    return { celtics, alerts };
  };

  it("keeps steam/sharp and EV alerts for pregame markets", () => {
    const { celtics, alerts } = build("pregame");
    expect(celtics.signals.steam).toBe(true);
    expect(celtics.ev).toBeGreaterThan(0.03);
    expect(alerts.some((alert) => alert.type === "positive_ev")).toBe(true);
  });

  it("drops signals and alerts for in-play markets and lowers confidence", () => {
    const pregame = build("pregame").celtics;
    const { celtics, alerts } = build("live");
    expect(celtics.signals).toMatchObject({ steam: false, sharp: false, reverse: false, moves: 4 });
    expect(alerts).toHaveLength(0);
    expect(celtics.confidence!.score).toBeLessThan(pregame.confidence!.score);
  });
});
