import { fireEvent, render, screen } from "@testing-library/react";
import { LeagueLeaders } from "./LeagueLeaders";
import type { LeaderBoard } from "../../lib/statsTypes";

const board: LeaderBoard = {
  key: "pts", label: "Points per game", short: "PTS", format: "dec1", direction: "desc", group: "players",
  leaders: [
    { rank: 1, id: "1", name: "Luka Doncic", shortName: "L. Doncic", headshot: null, teamAbbr: "LAL", position: "G", value: 40.11 },
    { rank: 2, id: "2", name: "Stephen Curry", shortName: "S. Curry", headshot: null, teamAbbr: "GS", position: "G", value: 31.25 },
  ],
};

describe("LeagueLeaders", () => {
  it("shows formatted leaders and opens a profile on click", () => {
    const onPlayer = jest.fn();
    render(<LeagueLeaders boards={[board]} groupLabels={{ players: "Players" }} filter={() => true} onPlayer={onPlayer} showSample={false} />);
    expect(screen.getByText("Points per game")).toBeInTheDocument();
    expect(screen.getByText("40.1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("S. Curry"));
    expect(onPlayer).toHaveBeenCalledWith("2");
  });

  it("respects filters", () => {
    render(<LeagueLeaders boards={[board]} groupLabels={{ players: "Players" }} filter={(entry) => entry.teamAbbr === "BOS"} onPlayer={() => undefined} showSample={false} />);
    expect(screen.getByText("No leaders match these filters.")).toBeInTheDocument();
  });
});
