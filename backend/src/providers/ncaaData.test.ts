import { normalizeClosingLine, normalizeEspnPolls, normalizeFutures, normalizeKenpom, normalizeNet, parseFutureName } from "./ncaaData";
import { normalizeGameLog, normalizeStandings } from "./espnStats";
import { summarizeTrends } from "../services/ncaaTrends";
import { LEAGUE_DEFINITIONS, usageRate } from "../services/statsMetrics";

jest.mock("../db/pool", () => ({ pool: { query: jest.fn() } }));

describe("NCAA data adapters", () => {
  it("normalizes the AP and Coaches polls", () => {
    const polls = normalizeEspnPolls({ rankings: [
      { type: "ap", season: 2027, occurrence: { displayValue: "Week 2" }, lastUpdated: "2026-11-09T21:19Z",
        ranks: [{ current: 2, previous: 3, points: 1400, firstPlaceVotes: 4, trend: "+1", team: { id: "150", location: "Duke", abbreviation: "DUKE" } }, { current: 1, previous: 1, points: 1490, firstPlaceVotes: 53, team: { id: "57", location: "Florida" } }],
        others: [{ current: 0, points: 97, team: { id: "235", location: "Memphis" } }] },
      { type: "usa", occurrence: { displayValue: "Week 2" }, ranks: [] },
      { type: "fcs", ranks: [] },
    ] });
    expect(polls.map((poll) => poll.key)).toEqual(["ap", "coaches"]);
    expect(polls[0]!.teams.map((team) => team.team)).toEqual(["Florida", "Duke"]);
    expect(polls[0]!.teams[1]).toMatchObject({ rank: 2, previousRank: 3, teamId: "150", firstPlaceVotes: 4 });
    expect(polls[0]!.others[0]).toMatchObject({ team: "Memphis", points: 97 });
  });

  it("normalizes NET and KenPom tables", () => {
    const net = normalizeNet({ updated: "Through Games Apr. 06 2026", data: [{ Rank: "1", School: "Michigan", Record: "37-3", Conf: "Big Ten", Prev: "2", "Quad 1": "21-3" }] });
    expect(net).toMatchObject({ key: "net", release: "Through Games Apr. 06 2026" });
    expect(net!.teams[0]).toMatchObject({ rank: 1, previousRank: 2, team: "Michigan", extra: { conference: "Big Ten", quad1: "21-3" } });
    expect(normalizeNet({ data: [] })).toBeNull();
    const kenpom = normalizeKenpom([{ TeamName: "Duke", RankAdjEM: 2, AdjEM: 31.2, AdjOE: 125.1, AdjDE: 93.9, AdjTempo: 68.4, Wins: 3, Losses: 0, RankSOS: 40 }, { teamName: "Houston", rankAdjEM: "1", adjEM: "33.0" }], 2027);
    expect(kenpom!.teams.map((team) => team.team)).toEqual(["Houston", "Duke"]);
    expect(kenpom!.teams[1]).toMatchObject({ record: "3-0", extra: { adjO: 125.1, adjTempo: 68.4, sosRank: 40 } });
  });

  it("classifies and normalizes futures", () => {
    expect(parseFutureName("NCAA(B) - Winner")).toMatchObject({ category: "championship", label: "National champion" });
    expect(parseFutureName("NCAA(B) - Big 12 Conference - Winner (reg. season)")).toMatchObject({ category: "conference", conference: "Big 12 Conference" });
    expect(parseFutureName("NCAA(B) - To Make The Final 4").category).toBe("tournament");
    const ref = (id: string) => ({ $ref: `http://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/seasons/2027/teams/${id}?lang=en` });
    const markets = normalizeFutures({ items: [
      { id: 232692, name: "NCAA(B) - Winner", futures: [{ provider: { name: "DraftKings" }, books: [{ team: ref("57"), value: "+650" }, { team: ref("150"), value: "+450" }, { team: ref("999"), value: "+900" }] }] },
      { id: 6100, name: "NCAA(M) - Wooden Award", futures: [{ provider: { name: "DraftKings" }, books: [{ athlete: { $ref: "x/athletes/1" }, value: "+850" }] }] },
    ] }, { team: (id) => ({ "57": "Florida", "150": "Duke" } as Record<string, string>)[id] ?? null });
    expect(markets).toHaveLength(1);
    expect(markets[0]).toMatchObject({ id: "232692", book: "draftkings", category: "championship" });
    expect(markets[0]!.outcomes).toEqual([{ name: "Duke", teamId: "150", athleteId: null, american: 450 }, { name: "Florida", teamId: "57", athleteId: null, american: 650 }]);
  });

  it("builds ATS and over/under records from closing lines", () => {
    const line = normalizeClosingLine({ items: [{ provider: { name: "DraftKings" }, spread: -39.5, overUnder: 139.5, homeTeamOdds: { close: { pointSpread: { american: "-38.5" } } } }] });
    expect(line).toEqual({ homeSpread: -38.5, total: 139.5, provider: "DraftKings" });
    const game = (eventId: string, home: boolean, pointsFor: number, pointsAgainst: number) => ({ eventId, date: "2026-11-09T00:00Z", home, opponentId: eventId, opponentAbbr: "", opponentLogo: null, pointsFor, pointsAgainst, result: pointsFor > pointsAgainst ? "W" as const : "L" as const });
    const trends = summarizeTrends(
      [game("1", true, 83, 41), game("2", false, 70, 75), game("3", true, 60, 50)],
      new Map([["1", line], ["2", { homeSpread: -5, total: 150, provider: "DraftKings" }], ["3", null]]),
      (id) => ({ "1": 0.5, "2": 0.75 } as Record<string, number>)[id] ?? null,
    );
    expect(trends.ats.record).toBe("1-0-1");
    expect(trends.overUnder.record).toBe("0-2-0");
    expect(trends.last5).toEqual({ record: "2-1", form: "WLW" });
    expect(trends.strengthOfSchedule.opponentWinPct).toBeCloseTo(0.625);
    expect(trends.gamesWithLines).toBe(2);
  });

  it("reads college standings and game logs", () => {
    const rows = normalizeStandings({ name: "NCAA Division I", children: [{ name: "Big Ten Conference", abbreviation: "big10", isConference: true, standings: { entries: [{ team: { id: "130", displayName: "Michigan Wolverines", abbreviation: "MICH" }, stats: [{ type: "total", displayValue: "3-0" }] }] } }] });
    expect(rows[0]).toMatchObject({ teamId: "130", conference: "Big Ten Conference", conferenceAbbr: "big10", division: "" });
    const log = normalizeGameLog({ names: ["points"], labels: ["PTS"], events: { "9": { id: "9", gameDate: "2026-11-05T00:00Z", atVs: "vs" } },
      seasonTypes: [{ displayName: "2026-27 Season", categories: [{ displayName: "Regular Season Stats", events: [{ eventId: "9", stats: ["18"] }] }, { displayName: "Postseason", events: [{ eventId: "9", stats: ["30"] }] }] }] });
    expect(log.games).toHaveLength(1);
    expect(log.games[0]!.values.points).toBe(18);
  });

  it("computes college tempo, efficiency and usage", () => {
    const own = { "offensive.avgPoints": 80, "offensive.avgFieldGoalsMade": 28, "offensive.avgFieldGoalsAttempted": 60, "offensive.avgThreePointFieldGoalsMade": 8, "offensive.avgFreeThrowsAttempted": 20, "offensive.avgTurnovers": 12, "offensive.avgOffensiveRebounds": 10, "defensive.avgDefensiveRebounds": 25, "general.avgRebounds": 35 };
    const opponent = { ...own, "offensive.avgPoints": 70, "general.avgRebounds": 30, "defensive.avgDefensiveRebounds": 22 };
    const context = { standing: { stats: {} } as never, stats: { own, opponent }, gamesPlayed: 3, extras: {} };
    const value = (key: string) => LEAGUE_DEFINITIONS.ncaab.teamMetrics.find((metric) => metric.key === key)!.compute(context)!;
    expect(value("pace")).toBeCloseTo(71.5);
    expect(value("offRating")).toBeCloseTo(111.9, 1);
    expect(value("netRating")).toBeCloseTo(14, 0);
    expect(value("efgPct")).toBeCloseTo(53.3, 1);
    expect(value("orbPct")).toBeCloseTo(31.25);
    expect(value("ftRate")).toBeCloseTo(33.3, 1);
    expect(usageRate({ "general.avgMinutes": 30, "offensive.avgFieldGoalsAttempted": 15, "offensive.avgFreeThrowsAttempted": 5, "offensive.avgTurnovers": 3 }, own)).toBeCloseTo(33.3, 1);
    expect(usageRate({ "general.avgMinutes": 2 }, own)).toBeNull();
    expect(LEAGUE_DEFINITIONS.ncaab.metrics.per!.season({ "general.PER": 0 })).toBeNull();
  });
});
