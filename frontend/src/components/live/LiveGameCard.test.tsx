import { render, screen } from "@testing-library/react";
import type { LiveGame, LiveTeam } from "../../lib/liveTypes";
import { LiveGameCard } from "./LiveGameCard";
import { StatusPill } from "../injuries/injuryUi";

const team = (id: string, abbr: string, score: number): LiveTeam => ({ id, name: abbr, shortName: abbr, abbr, logo: null, score, record: null, linescores: [], winner: false, timeouts: 2, fouls: 4, inBonus: false, shots: null });

const game: LiveGame = {
  id: "1", league: "nfl", name: "BUF at MIN", shortName: "BUF @ MIN", startTime: "2026-11-10T01:15:00Z", status: "live", statusDetail: "4:12 - 3rd", statusLabel: "Live",
  clock: "4:12", period: 3, periodLabel: "Q3", home: team("16", "MIN", 17), away: team("2", "BUF", 20),
  situation: { possessionTeamId: "2", lastPlay: "Allen pass complete", down: 3, distance: 7, yardLine: 18, downDistance: "3rd & 7 at MIN 18", possessionText: "BUF ball", isRedZone: true,
    balls: null, strikes: null, outs: null, onFirst: false, onSecond: false, onThird: false, pitcher: null, batter: null, powerPlay: null, penalties: [] },
  venue: null, broadcast: "ESPN", homeWinProbability: 0.41, espnOdds: { current: null, open: null }, oddsGameId: "x",
  lines: { source: "multi-book", books: 6, updatedAt: null, moneyline: { home: 150, away: -170, homeBook: "fanduel", awayBook: "draftkings" }, spread: { homeLine: 3.5, homeOdds: -110, awayLine: -3.5, awayOdds: -110 }, total: { line: 44.5, over: -110, under: -110 }, marketHomeProbability: 0.4 },
  winProbability: { home: 0.41, away: 0.59, source: "ESPN" },
};

describe("LiveGameCard", () => {
  it("shows the live football situation, win probability and lines", () => {
    render(<LiveGameCard game={game} league="nfl" onOpen={() => undefined} />);
    expect(screen.getByText("3rd & 7 at MIN 18")).toBeInTheDocument();
    expect(screen.getByText(/RED ZONE/)).toBeInTheDocument();
    expect(screen.getByText("59%")).toBeInTheDocument();
    expect(screen.getByText("O 44.5 -110")).toBeInTheDocument();
    expect(screen.getByText("Q3 · 4:12")).toBeInTheDocument();
  });

  it("labels active injury listings as returning", () => {
    render(<StatusPill status="Active" />);
    expect(screen.getByText("Returning")).toBeInTheDocument();
  });
});
