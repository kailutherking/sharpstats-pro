import { fetchEventMarkets, normalizeEventQuotes, rejectedMarketKeys, type ApiEvent } from "./theOddsApi";
import { normalizeEspnEvent, parseAmerican, parseLine, type EspnEvent } from "./espnOdds";

/** Shape of The Odds API v4 /events/{id}/odds responses (american odds format). */
const event: ApiEvent = {
  id: "e912304de2b2ce35b473ce2ecd3d1502",
  sport_key: "basketball_nba",
  commence_time: "2026-11-09T00:10:00Z",
  home_team: "Boston Celtics",
  away_team: "New York Knicks",
  bookmakers: [
    {
      key: "draftkings", title: "DraftKings", last_update: "2026-11-08T17:00:00Z",
      markets: [
        { key: "h2h", last_update: "2026-11-08T17:00:01Z", outcomes: [{ name: "Boston Celtics", price: -150 }, { name: "New York Knicks", price: 130 }] },
        { key: "spreads", outcomes: [{ name: "Boston Celtics", price: -110, point: -3.5 }, { name: "New York Knicks", price: -110, point: 3.5 }] },
        { key: "player_points", outcomes: [
          { name: "Over", description: "Jalen Brunson", price: -115, point: 26.5 },
          { name: "Under", description: "Jalen Brunson", price: -105, point: 26.5 },
        ] },
      ],
    },
    { key: "williamhill_us", title: "Caesars", markets: [{ key: "h2h", outcomes: [{ name: "Boston Celtics", price: -145 }, { name: "New York Knicks", price: 125 }] }] },
    { key: "unknown_book", title: "Unknown", markets: [{ key: "h2h", outcomes: [{ name: "Boston Celtics", price: -140 }] }] },
  ],
};

describe("The Odds API normalization", () => {
  it("maps bookmakers to registry keys and keeps player/point details", () => {
    const quotes = normalizeEventQuotes("nba", event);
    expect(quotes).toHaveLength(8);
    expect(quotes.find((quote) => quote.book === "caesars" && quote.selection === "New York Knicks")?.american).toBe(125);
    const over = quotes.find((quote) => quote.market === "player_points" && quote.selection === "Over")!;
    expect(over).toMatchObject({ participant: "Jalen Brunson", point: 26.5, american: -115, book: "draftkings" });
    expect(over.decimal).toBeCloseTo(1.8696, 3);
    expect(quotes.find((quote) => quote.market === "h2h" && quote.book === "draftkings")?.bookUpdatedAt).toBe("2026-11-08T17:00:01Z");
  });

  it("retries markets one by one after a 422 and remembers the rejected key", async () => {
    process.env.ODDS_API_KEY = "test-key";
    const calls: string[] = [];
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const markets = url.searchParams.get("markets") ?? "";
      calls.push(markets);
      if (markets.includes("player_minutes")) {
        return new Response(JSON.stringify({ message: "Invalid market", error_code: "INVALID_MARKET" }), { status: 422 });
      }
      return new Response(JSON.stringify({ ...event, bookmakers: [event.bookmakers![0]] }), { status: 200, headers: { "x-requests-remaining": "480", "x-requests-used": "20", "x-requests-last": "1" } });
    });
    try {
      const result = await fetchEventMarkets("nba", event.id, ["player_points", "player_minutes"]);
      expect(calls).toEqual(["player_points,player_minutes", "player_points", "player_minutes"]);
      expect(result.quotes.length).toBeGreaterThan(0);
      expect(rejectedMarketKeys("nba")).toContain("player_minutes");
      calls.length = 0;
      await fetchEventMarkets("nba", event.id, ["player_points", "player_minutes"]);
      expect(calls).toEqual(["player_points"]);
    } finally {
      fetchMock.mockRestore();
      delete process.env.ODDS_API_KEY;
    }
  });
});

/** Trimmed from a live ESPN NFL scoreboard response (DraftKings odds). */
const espnEvent: EspnEvent = {
  id: "401873045",
  date: "2026-11-08T18:00Z",
  competitions: [{
    status: { type: { state: "pre" } },
    competitors: [
      { homeAway: "home", team: { displayName: "Kansas City Chiefs", abbreviation: "KC", logo: "https://a.espncdn.com/kc.png" } },
      { homeAway: "away", team: { displayName: "New York Jets", abbreviation: "NYJ" } },
    ],
    odds: [{
      provider: { name: "DraftKings" },
      moneyline: { home: { close: { odds: "-520" }, open: { odds: "-470" } }, away: { close: { odds: "+390" }, open: { odds: "+360" } } },
      pointSpread: { home: { close: { line: "-9.5", odds: "-110" }, open: { line: "-9.5", odds: "-112" } }, away: { close: { line: "+9.5", odds: "-110" }, open: { line: "+9.5", odds: "-108" } } },
      total: { over: { close: { line: "o47.5", odds: "-110" }, open: { line: "o48.5", odds: "-110" } }, under: { close: { line: "u47.5", odds: "-110" }, open: { line: "u48.5", odds: "-110" } } },
    }],
  }],
};

describe("ESPN odds normalization", () => {
  it("parses ESPN price and line strings", () => {
    expect(parseAmerican("+390")).toBe(390);
    expect(parseAmerican("EVEN")).toBe(100);
    expect(parseAmerican("OFF")).toBeNull();
    expect(parseLine("o47.5")).toBe(47.5);
    expect(parseLine("+9.5")).toBe(9.5);
    expect(parseLine("PK")).toBe(0);
  });

  it("builds DraftKings quotes with provider openers", () => {
    const normalized = normalizeEspnEvent("nfl", espnEvent)!;
    expect(normalized.game).toMatchObject({ id: "espn-401873045", homeTeam: "Kansas City Chiefs", awayAbbr: "NYJ", status: "pregame" });
    expect(normalized.quotes).toHaveLength(6);
    const over = normalized.quotes.find((quote) => quote.selection === "Over")!;
    expect(over).toMatchObject({ market: "totals", book: "draftkings", point: 47.5, american: -110, providerOpen: { american: -110, point: 48.5 } });
    expect(normalized.quotes.find((quote) => quote.market === "h2h" && quote.selection === "New York Jets")?.providerOpen?.american).toBe(360);
  });
});
