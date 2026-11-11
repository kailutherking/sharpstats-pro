import { fetchClosingLine, type ClosingLine } from "../providers/ncaaData";
import type { ProviderTeamGame } from "../providers/espnStats";
import { cached } from "./statsCache";

/** Closing lines of finished games never change, so they are cached (and persisted) for a month. */
const CLOSING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 6;

export interface TeamTrends {
  /** Against-the-spread record as wins-losses-pushes, from DraftKings closing lines. */
  ats: { wins: number; losses: number; pushes: number; record: string; games: number };
  overUnder: { overs: number; unders: number; pushes: number; record: string; games: number };
  last5: { record: string; form: string };
  last10: { record: string; form: string };
  /** Strength of schedule: average winning percentage of Division I opponents played so far. */
  strengthOfSchedule: { opponentWinPct: number | null; opponents: number; rank: number | null; source: string };
  gamesWithLines: number;
  note: string;
}

export type SpreadResult = "win" | "loss" | "push";

export function spreadResult(pointsFor: number, pointsAgainst: number, home: boolean, line: Pick<ClosingLine, "homeSpread">): SpreadResult | null {
  if (line.homeSpread === null) return null;
  const margin = pointsFor - pointsAgainst + (home ? line.homeSpread : -line.homeSpread);
  return margin === 0 ? "push" : margin > 0 ? "win" : "loss";
}

export function totalResult(pointsFor: number, pointsAgainst: number, line: Pick<ClosingLine, "total">): "over" | "under" | "push" | null {
  if (line.total === null) return null;
  const total = pointsFor + pointsAgainst;
  return total === line.total ? "push" : total > line.total ? "over" : "under";
}

function form(games: ProviderTeamGame[]) {
  const wins = games.filter((game) => game.result === "W").length;
  return { record: `${wins}-${games.length - wins}`, form: games.map((game) => game.result).join("") };
}

export function summarizeTrends(
  games: ProviderTeamGame[],
  lines: Map<string, ClosingLine | null>,
  opponentWinPct: (teamId: string) => number | null,
  kenpom: { sos: number | null; sosRank: number | null } | null = null,
): TeamTrends {
  const ats = { wins: 0, losses: 0, pushes: 0 };
  const ou = { overs: 0, unders: 0, pushes: 0 };
  let withLines = 0;
  for (const game of games) {
    const line = lines.get(game.eventId);
    if (!line) continue;
    withLines += 1;
    const spread = spreadResult(game.pointsFor, game.pointsAgainst, game.home, line);
    if (spread === "win") ats.wins += 1; else if (spread === "loss") ats.losses += 1; else if (spread === "push") ats.pushes += 1;
    const total = totalResult(game.pointsFor, game.pointsAgainst, line);
    if (total === "over") ou.overs += 1; else if (total === "under") ou.unders += 1; else if (total === "push") ou.pushes += 1;
  }
  const opponents = games.map((game) => opponentWinPct(game.opponentId)).filter((value): value is number => value !== null);
  return {
    ats: { ...ats, record: `${ats.wins}-${ats.losses}-${ats.pushes}`, games: ats.wins + ats.losses + ats.pushes },
    overUnder: { ...ou, record: `${ou.overs}-${ou.unders}-${ou.pushes}`, games: ou.overs + ou.unders + ou.pushes },
    last5: form(games.slice(0, 5)),
    last10: form(games.slice(0, 10)),
    strengthOfSchedule: kenpom?.sosRank
      ? { opponentWinPct: opponents.length ? opponents.reduce((a, b) => a + b, 0) / opponents.length : null, opponents: opponents.length, rank: kenpom.sosRank, source: "KenPom strength of schedule rank" }
      : { opponentWinPct: opponents.length ? opponents.reduce((a, b) => a + b, 0) / opponents.length : null, opponents: opponents.length, rank: null, source: "Average win % of Division I opponents played" },
    gamesWithLines: withLines,
    note: withLines < games.length
      ? `Closing lines were published for ${withLines} of ${games.length} games (games against non-Division I opponents are usually not lined).`
      : "Records use DraftKings closing lines published by ESPN.",
  };
}

export async function teamTrends(games: ProviderTeamGame[], opponentWinPct: (teamId: string) => number | null, kenpom: { sos: number | null; sosRank: number | null } | null = null): Promise<TeamTrends> {
  const lines = new Map<string, ClosingLine | null>();
  for (let index = 0; index < games.length; index += CONCURRENCY) {
    await Promise.all(games.slice(index, index + CONCURRENCY).map(async (game) => {
      const line = await cached(`ncaab:closing:${game.eventId}`, CLOSING_TTL_MS, () => fetchClosingLine(game.eventId), { persist: true })
        .then((result) => result.data).catch(() => null);
      lines.set(game.eventId, line);
    }));
  }
  return summarizeTrends(games, lines, opponentWinPct, kenpom);
}
