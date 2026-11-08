import type { ClvData } from "../../lib/oddsTypes";
import { american, pct, signedPct } from "../../lib/oddsFormat";
import { EmptyState, LoadingBlock, Panel, StatTile, thClass } from "../stats/StatsUi";

function decimalToAmerican(decimal: number): number {
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

/** Closing line value for the user's bets: settled CLV vs the closing price, and live CLV vs today's fair price. */
export function ClvTracker({ data, loading }: { data: ClvData | undefined; loading: boolean }) {
  if (loading && !data) return <LoadingBlock label="Calculating closing line value…" />;
  if (!data) return <Panel><EmptyState>CLV data is unavailable.</EmptyState></Panel>;
  const { summary } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Average CLV" value={signedPct(summary.averageClv)} highlight={(summary.averageClv ?? 0) > 0} sub={`${summary.closed} bets with a closing price`} />
        <StatTile label="Beat the close" value={pct(summary.beatClosePct, 0)} sub="Share of bets priced better than close" />
        <StatTile label="Tracking live" value={String(summary.tracking)} sub="Open bets linked to a live market" />
        <StatTile label="Bets reviewed" value={String(summary.bets)} sub="Last 120 days" />
      </div>
      <Panel title="CLV tracker" subtitle="Bets logged from the odds screen are linked to the market; closing prices are captured automatically when the game starts" flush>
        {!data.rows.length ? <EmptyState>Log bets from the market board (the + button) to track closing line value.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead><tr className={thClass}><th className="px-4 py-3">BET</th><th className="px-3 py-3">BOOK</th><th className="px-3 py-3 text-right">TAKEN</th><th className="px-3 py-3 text-right">CLOSE</th><th className="px-3 py-3 text-right">CLV</th><th className="px-3 py-3 text-right">FAIR NOW</th><th className="px-3 py-3 text-right">LIVE CLV</th><th className="px-4 py-3">STATUS</th></tr></thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} className="border-t border-line text-xs">
                    <td className="px-4 py-2.5"><p className="font-medium text-white">{row.selection}</p><p className="mt-0.5 text-[10px] text-muted">{row.event} · {new Date(row.betDate).toLocaleDateString()}</p></td>
                    <td className="px-3 py-2.5 text-[#d9e0dc]">{row.sportsbook}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-white">{american(decimalToAmerican(row.odds))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{row.closingOdds ? american(decimalToAmerican(row.closingOdds)) : "—"}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${row.clv === null ? "text-muted" : row.clv >= 0 ? "text-lime" : "text-rose-400"}`}>{signedPct(row.clv)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{american(row.current?.american)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${row.liveClv === null ? "text-muted" : row.liveClv >= 0 ? "text-lime" : "text-rose-400"}`}>{signedPct(row.liveClv)}</td>
                    <td className="px-4 py-2.5"><span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ${row.status === "closed" ? "bg-[#1b2428] text-[#c9d2cf]" : row.status === "tracking" ? "bg-lime/10 text-lime" : "text-muted"}`}>{row.status === "unlinked" ? "Not linked" : row.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
