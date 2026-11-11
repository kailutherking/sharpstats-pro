import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { SimGroup } from "../../lib/simTypes";
import { CurveChart } from "../Charts";

const usd = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedPct = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function GroupTable({ title, note, rows, empty }: { title: string; note?: string; rows: SimGroup[]; empty: string }) {
  return <div className="overflow-hidden rounded-2xl border border-line bg-panel">
    <div className="border-b border-line px-5 py-4"><p className="text-sm font-semibold">{title}</p>{note && <p className="mt-1 text-[11px] text-muted">{note}</p>}</div>
    {!rows.length ? <p className="px-5 py-6 text-xs text-muted">{empty}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[440px] text-left text-xs">
      <thead><tr className="text-[9px] font-semibold tracking-wider text-[#738087]"><th className="px-5 py-2.5">GROUP</th><th className="px-3 py-2.5 text-right">BETS</th><th className="px-3 py-2.5 text-right">W-L</th><th className="px-3 py-2.5 text-right">ROI</th><th className="px-3 py-2.5 text-right">UNITS</th><th className="px-5 py-2.5 text-right">P/L</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.label} className="border-t border-line">
        <td className="px-5 py-2.5 font-medium capitalize">{row.label}</td><td className="px-3 py-2.5 text-right text-muted">{row.bets}</td><td className="px-3 py-2.5 text-right text-muted">{row.wins}-{row.losses}</td>
        <td className={`px-3 py-2.5 text-right ${row.roi >= 0 ? "text-lime" : "text-rose-400"}`}>{signedPct(row.roi)}</td><td className="px-3 py-2.5 text-right">{row.units >= 0 ? "+" : ""}{row.units.toFixed(2)}u</td>
        <td className={`px-5 py-2.5 text-right font-semibold ${row.profitLoss >= 0 ? "text-white" : "text-rose-400"}`}>{row.profitLoss > 0 ? "+" : ""}{usd(row.profitLoss)}</td>
      </tr>)}</tbody></table></div>}
  </div>;
}

/** Performance of simulated wagers: curves, ROI by sport, conference, bet type and sportsbook, and NCAA splits. */
export function SimAnalytics() {
  const analytics = useQuery({ queryKey: ["sim-analytics"], queryFn: api.simAnalytics });
  const history = useQuery({ queryKey: ["bankroll-history"], queryFn: api.bankrollHistory });
  const data = analytics.data;
  if (analytics.error instanceof Error) return <p className="mt-6 rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">{analytics.error.message}</p>;
  if (!data) return <p className="mt-6 text-sm text-muted">Loading simulation analytics…</p>;
  const totals = data.totals;
  const tiles: Array<[string, string]> = [
    ["Simulated P/L", `${totals.profitLoss > 0 ? "+" : ""}${usd(totals.profitLoss)}`], ["ROI", signedPct(totals.roi)], ["Units", `${totals.units >= 0 ? "+" : ""}${totals.units.toFixed(2)}u`],
    ["Win rate", `${totals.winRate.toFixed(1)}% (${totals.wins}-${totals.losses})`], ["Avg CLV", signedPct(totals.avgClv)], ["Avg EV at bet", signedPct(totals.avgEv)],
  ];
  return <div className="mt-8">
    <div className="mb-4"><p className="mb-2 text-[10px] font-bold tracking-[0.17em] text-lime">SIMULATION</p><h3 className="font-display text-xl font-extrabold">Simulated betting performance</h3><p className="mt-1 text-sm text-muted">Bet-slip wagers only. {totals.bets} settled · {data.bankroll.pendingBets} open with {usd(data.bankroll.exposure)} at risk.</p></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{tiles.map(([label, value]) => <div key={label} className="rounded-2xl border border-line bg-panel p-4"><p className="text-[11px] text-muted">{label}</p><p className="mt-2 font-display text-lg font-bold">{value}</p></div>)}</div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-line bg-panel p-5"><p className="text-sm font-semibold">Profit curve</p><p className="mb-3 mt-1 text-[11px] text-muted">Cumulative profit of settled simulated wagers</p>
        <CurveChart id="simProfit" name="Cumulative P/L" signed empty="Settle a simulated wager to start the profit curve." points={data.profitCurve.map((point) => ({ label: day(point.date), value: point.cumulative }))} /></div>
      <div className="rounded-2xl border border-line bg-panel p-5"><p className="text-sm font-semibold">Bankroll curve</p><p className="mb-3 mt-1 text-[11px] text-muted">Settled bankroll after each day's results (all tracked bets)</p>
        <CurveChart id="simBankroll" name="Bankroll" empty="Your bankroll curve appears after the first graded bet." points={(history.data?.curve ?? []).map((point) => ({ label: day(point.date), value: point.bankroll }))} /></div>
    </div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <GroupTable title="Sport ROI" rows={data.bySport} empty="No settled simulated wagers yet." />
      <GroupTable title="Bet type ROI" rows={data.byBetType} empty="No settled simulated wagers yet." />
      <GroupTable title="Sportsbook ROI" rows={data.byBook} empty="No settled simulated wagers yet." />
      <GroupTable title="Conference ROI" note="NCAA wagers by conference; games between two leagues count as non-conference." rows={data.byConference} empty="No settled NCAA wagers yet." />
      <GroupTable title="NCAA by market" note="Singles on college basketball, split by market and period." rows={data.ncaa.markets} empty="No settled NCAA singles yet." />
      <GroupTable title="NCAA sides and totals" note="Home teams vs road teams, overs vs unders." rows={data.ncaa.sides} empty="No settled NCAA sides or totals yet." />
    </div>
  </div>;
}

/** Bankroll page: what is reserved by open simulated wagers, and the ledger of every movement. */
export function BankrollLedger() {
  const history = useQuery({ queryKey: ["bankroll-history"], queryFn: api.bankrollHistory });
  const data = history.data;
  if (!data) return null;
  const bankroll = data.bankroll;
  return <div className="mt-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {[["Available to stake", usd(bankroll.available)], ["Open exposure", usd(bankroll.exposure)], ["Risk", `${bankroll.riskPct.toFixed(1)}% of bankroll`], ["Units at risk", `${bankroll.exposureUnits.toFixed(2)}u`], ["Open positions", `${bankroll.pendingBets} · pays ${usd(bankroll.potentialPayout)}`]]
        .map(([label, value]) => <div key={label} className="rounded-2xl border border-line bg-panel p-4"><p className="text-[11px] text-muted">{label}</p><p className="mt-2 font-display text-lg font-bold">{value}</p></div>)}
    </div>
    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
      <div className="rounded-2xl border border-line bg-panel p-5"><p className="text-sm font-semibold">Bankroll growth</p><p className="mb-3 mt-1 text-[11px] text-muted">Settled bankroll by day</p>
        <CurveChart id="bankrollGrowth" name="Bankroll" empty="Your bankroll curve appears after the first graded bet." points={data.curve.map((point) => ({ label: day(point.date), value: point.bankroll }))} /></div>
      <div className="overflow-hidden rounded-2xl border border-line bg-panel"><div className="border-b border-line px-5 py-4"><p className="text-sm font-semibold">Bankroll transactions</p><p className="mt-1 text-[11px] text-muted">Simulated stakes, payouts, refunds and adjustments</p></div>
        {!data.transactions.length ? <p className="px-5 py-6 text-xs text-muted">No transactions yet. Placing a simulated wager reserves its stake here.</p>
          : <ul className="max-h-[300px] divide-y divide-line overflow-y-auto">{data.transactions.map((row) => <li key={row.id} className="flex items-center justify-between gap-3 px-5 py-3 text-xs">
            <div className="min-w-0"><p className="truncate font-medium">{row.note || row.kind}</p><p className="mt-0.5 text-[10px] capitalize text-muted">{row.kind} · {new Date(row.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></div>
            <div className="shrink-0 text-right"><p className={`font-semibold ${row.amount >= 0 ? "text-lime" : "text-white"}`}>{row.amount > 0 ? "+" : ""}{usd(row.amount)}</p><p className="mt-0.5 text-[10px] text-muted">{usd(row.balanceAfter)} available</p></div>
          </li>)}</ul>}
      </div>
    </div>
  </div>;
}
