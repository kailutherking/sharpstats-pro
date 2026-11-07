export interface NormalizedOdds {
  sport: string;
  event: string;
  commenceTime: string;
  sportsbook: string;
  market: string;
  point?: number;
  outcome: string;
  decimalOdds: number;
  eventId: string;
}

const PROP_MARKETS = [
  "player_points", "player_rebounds", "player_assists", "player_threes",
  "player_points_rebounds_assists", "player_blocks", "player_steals",
];

export async function getOddsApiLines(
  sportKey = "basketball_nba",
  includeProps = false,
): Promise<NormalizedOdds[]> {
  const key = process.env.ODDS_API_KEY;
  if (!key) return [];
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/odds`);
  url.searchParams.set("apiKey", key);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", ["h2h", "spreads", "totals", ...(includeProps ? PROP_MARKETS : [])].join(","));
  url.searchParams.set("oddsFormat", "decimal");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The Odds API request failed (${response.status})`);
  const events = await response.json() as Array<{
    id: string; sport_title: string; home_team: string; away_team: string; commence_time: string;
    bookmakers: Array<{ title: string; markets: Array<{ key: string; outcomes: Array<{ name: string; price: number; point?: number }> }> }>;
  }>;
  return events.flatMap((event) => event.bookmakers.flatMap((book) =>
    book.markets.flatMap((market) => market.outcomes.map((outcome) => ({
      sport: event.sport_title,
      event: `${event.away_team} @ ${event.home_team}`,
      commenceTime: event.commence_time,
      sportsbook: book.title,
      market: market.key,
      point: outcome.point,
      outcome: outcome.name,
      decimalOdds: outcome.price,
      eventId: event.id,
    })),
  )));
}

export interface ScoredEvent {
  id: string;
  sport_title: string;
  home_team: string;
  away_team: string;
  completed: boolean;
  scores: { name: string; score: string }[] | null;
}

export async function getOddsApiScores(sportKey: string): Promise<ScoredEvent[]> {
  const key = process.env.ODDS_API_KEY;
  if (!key) return [];
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/scores`);
  url.searchParams.set("apiKey", key);
  url.searchParams.set("daysFrom", "3");
  url.searchParams.set("dateFormat", "iso");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The Odds API scores request failed (${response.status})`);
  return response.json() as Promise<ScoredEvent[]>;
}
