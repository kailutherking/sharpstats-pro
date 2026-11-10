import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BadgeCheck } from "lucide-react";
import { api } from "../../lib/api";
import type { LeaderMetric, LeaderPeriod } from "../../lib/socialTypes";
import { Avatar, EmptyState, LoadingBlock, Panel, Segmented, thClass } from "../stats/StatsUi";
import { ratio, units } from "./socialUi";

type Board = LeaderMetric | "books";
const BOARDS: Array<{ value: Board; label: string }> = [
  { value: "units", label: "Units won" }, { value: "roi", label: "ROI" }, { value: "winrate", label: "Win rate" }, { value: "props", label: "Props" }, { value: "books", label: "Sportsbooks" },
];

/** Global / following leaderboards from shared picks, plus how shared picks perform by sportsbook. */
export function Leaderboards({ onProfile }: { onProfile: (handle: string) => void }) {
  const [board, setBoard] = useState<Board>("units");
  const [period, setPeriod] = useState<LeaderPeriod>("30d");
  const [scope, setScope] = useState<"global" | "following">("global");
  const metric: LeaderMetric = board === "books" ? "units" : board;
  const leaders = useQuery({ queryKey: ["leaderboard", metric, period, scope], queryFn: () => api.leaderboard(metric, period, scope), enabled: board !== "books" });
  const books = useQuery({ queryKey: ["leaderboard-books", period], queryFn: () => api.bookLeaderboard(period), enabled: board === "books" });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Leaderboard" value={board} onChange={setBoard} options={BOARDS} />
        <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }, { value: "all", label: "All time" }]} />
        {board !== "books" && <Segmented label="Scope" value={scope} onChange={setScope} options={[{ value: "global", label: "Global" }, { value: "following", label: "Friends" }]} />}
      </div>
      {board === "books" ? (
        <Panel title="Sportsbook leaderboard" subtitle="How the community's shared picks have done at each book (3+ settled picks)" flush>
          {books.isLoading ? <LoadingBlock label="Loading…" /> : books.data?.books.length ? (
            <table className="w-full text-xs tabular-nums">
              <thead><tr className={`${thClass} border-b border-line text-left`}><th className="px-4 py-2.5">SPORTSBOOK</th><th className="px-3 py-2.5 text-right">PICKS</th><th className="px-3 py-2.5 text-right">W-L</th><th className="px-3 py-2.5 text-right">UNITS</th><th className="px-3 py-2.5 text-right">ROI</th><th className="px-4 py-2.5 text-right">BETTORS</th></tr></thead>
              <tbody>{books.data.books.map((row) => <tr key={row.sportsbook} className="border-b border-line/60 last:border-0"><td className="px-4 py-2.5 font-semibold text-white">{row.sportsbook}</td><td className="px-3 py-2.5 text-right">{row.picks}</td><td className="px-3 py-2.5 text-right">{row.wins}-{row.losses}</td><td className={`px-3 py-2.5 text-right font-semibold ${row.units >= 0 ? "text-lime" : "text-rose-400"}`}>{units(row.units)}</td><td className="px-3 py-2.5 text-right">{ratio(row.roi)}</td><td className="px-4 py-2.5 text-right">{row.bettors}</td></tr>)}</tbody>
            </table>
          ) : <EmptyState>No sportsbook has 3 settled shared picks in this period yet.</EmptyState>}
        </Panel>
      ) : (
        <Panel title={`${BOARDS.find((item) => item.value === board)!.label} leaderboard`} subtitle={`Shared picks only · minimum ${leaders.data?.minPicks ?? "…"} settled picks · private bet tracker records never appear`} flush>
          {leaders.isLoading ? <LoadingBlock label="Loading leaderboard…" /> : leaders.data?.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-xs tabular-nums">
                <thead><tr className={`${thClass} border-b border-line text-left`}><th className="px-4 py-2.5">#</th><th className="px-3 py-2.5">BETTOR</th><th className="px-3 py-2.5 text-right">PICKS</th><th className="px-3 py-2.5 text-right">W-L-P</th><th className="px-3 py-2.5 text-right">WIN %</th><th className="px-3 py-2.5 text-right">UNITS</th><th className="px-3 py-2.5 text-right">ROI</th><th className="px-4 py-2.5 text-right">VERIFIED</th></tr></thead>
                <tbody>
                  {leaders.data.rows.map((row) => {
                    const move = row.previousRank === null ? null : row.previousRank - row.rank;
                    return (
                      <tr key={row.userId} className={`border-b border-line/60 last:border-0 ${leaders.data.me?.userId === row.userId ? "bg-lime/[0.04]" : ""}`}>
                        <td className="px-4 py-2.5"><span className={`font-display text-sm font-extrabold ${row.rank <= 3 ? "text-lime" : "text-white"}`}>{row.rank}</span>{move ? <span className={`ml-1 inline-flex items-center text-[9px] ${move > 0 ? "text-lime" : "text-rose-400"}`}>{move > 0 ? <ArrowUp size={9} /> : <ArrowDown size={9} />}{Math.abs(move)}</span> : null}</td>
                        <td className="px-3 py-2.5"><button type="button" onClick={() => onProfile(row.handle)} className="flex items-center gap-2 text-left hover:text-lime"><Avatar src={row.avatarUrl} name={row.name} size={26} /><span><span className="block font-semibold text-white">{row.name}</span><span className="block text-[10px] text-muted">@{row.handle} · LV {row.level}</span></span></button></td>
                        <td className="px-3 py-2.5 text-right">{row.picks}</td>
                        <td className="px-3 py-2.5 text-right">{row.wins}-{row.losses}-{row.pushes}</td>
                        <td className={`px-3 py-2.5 text-right ${board === "winrate" ? "font-bold text-lime" : ""}`}>{ratio(row.winRate)}</td>
                        <td className={`px-3 py-2.5 text-right font-semibold ${board === "units" || board === "props" ? (row.units >= 0 ? "text-lime" : "text-rose-400") : row.units >= 0 ? "text-white" : "text-rose-400"}`}>{units(row.units)}</td>
                        <td className={`px-3 py-2.5 text-right ${board === "roi" ? "font-bold text-lime" : ""}`}>{ratio(row.roi)}</td>
                        <td className="px-4 py-2.5 text-right"><span className="inline-flex items-center gap-1 text-sky-300" title="Shared before the game and graded from the final score"><BadgeCheck size={11} />{row.verified}/{row.picks}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <EmptyState>{scope === "following" ? "Nobody you follow has enough settled picks in this period yet." : "No bettor has enough settled shared picks in this period yet. Share picks from the Bet tracker to get on the board."}</EmptyState>}
        </Panel>
      )}
    </div>
  );
}
