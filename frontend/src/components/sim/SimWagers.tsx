import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import { american } from "../../lib/oddsFormat";
import type { Wager } from "../../lib/simTypes";
import { SIM_QUERY_KEYS } from "./BetSlip";

const usd = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const STATUS_STYLE: Record<Wager["status"], string> = {
  open: "bg-amber-400/10 text-amber-300", won: "bg-lime/10 text-lime", lost: "bg-rose-400/10 text-rose-400", push: "bg-slate-400/10 text-slate-300", void: "bg-slate-400/10 text-slate-300",
};

/** Open positions and settled history for simulated wagers, with exposure against the bankroll. */
export function SimWagers() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"open" | "settled">("open");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const openQuery = useQuery({ queryKey: ["open-bets"], queryFn: api.openBets, refetchInterval: 60_000 });
  const settledQuery = useQuery({ queryKey: ["sim-bets", "settled"], queryFn: () => api.simBets("settled"), enabled: tab === "settled" });
  const bankroll = openQuery.data?.bankroll;
  const wagers = tab === "open" ? openQuery.data?.wagers ?? [] : settledQuery.data?.wagers ?? [];
  const refresh = () => { for (const key of SIM_QUERY_KEYS) void queryClient.invalidateQueries({ queryKey: [key] }); };

  async function run(id: string, work: () => Promise<string>) {
    setBusy(id);
    try { setMessage(await work()); refresh(); }
    catch (issue) { setMessage(issue instanceof Error ? issue.message : "Something went wrong"); }
    finally { setBusy(""); }
  }
  const grade = () => run("grade", async () => {
    const result = await api.gradeOpenBets();
    return result.settled ? `Graded ${result.settled} wager${result.settled === 1 ? "" : "s"}: ${result.won} won, ${result.lost} lost, ${result.refunded} refunded.` : result.checked ? "No results yet. Wagers are graded automatically once their games go final." : "No open wagers have started yet.";
  });

  return <div className="mb-4 overflow-hidden rounded-2xl border border-line bg-panel">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
      <div><p className="text-sm font-semibold">Simulated wagers <span className="ml-1 rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-amber-300">NO REAL MONEY</span></p><p className="mt-1 text-[11px] text-muted">Placed from the bet slip, staked from your bankroll and graded automatically from final scores.</p></div>
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-line p-0.5 text-[11px]">{(["open", "settled"] as const).map((value) => <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value} className={`rounded-md px-3 py-1.5 capitalize ${tab === value ? "bg-[#202b24] font-semibold text-lime" : "text-muted hover:text-white"}`}>{value === "open" ? `Open (${openQuery.data?.wagers.length ?? 0})` : "Settled"}</button>)}</div>
        <button type="button" onClick={() => void grade()} disabled={busy === "grade"} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[11px] hover:border-lime hover:text-lime disabled:opacity-50"><RefreshCw size={12} className={busy === "grade" ? "animate-spin" : ""} />Grade now</button>
      </div>
    </div>
    {bankroll && <div className="grid grid-cols-2 gap-px border-b border-line bg-line text-xs sm:grid-cols-5">
      {[["Available", usd(bankroll.available)], ["Exposure", usd(bankroll.exposure)], ["Risk", `${bankroll.riskPct.toFixed(1)}% · ${bankroll.exposureUnits.toFixed(1)}u`], ["Pending bets", String(bankroll.pendingBets)], ["Potential payout", usd(bankroll.potentialPayout)]]
        .map(([label, value]) => <div key={label} className="bg-panel px-5 py-3"><p className="text-[10px] text-muted">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}
    </div>}
    {message && <p className="border-b border-line px-5 py-2.5 text-xs text-muted">{message}</p>}
    {!wagers.length ? <p className="px-5 py-8 text-center text-xs text-muted">{tab === "open" ? "No open simulated wagers. Add selections to the bet slip from the Odds screen." : "No settled simulated wagers yet."}</p>
      : <ul className="divide-y divide-line">{wagers.map((wager) => <li key={wager.id} className="px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold leading-snug">{wager.legs.length === 1 ? wager.legs[0]!.label : `${wager.legs.length}-leg ${wager.betTypeLabel.toLowerCase()}`} <span className={`ml-1 rounded-md px-2 py-0.5 text-[9px] font-semibold capitalize ${STATUS_STYLE[wager.status]}`}>{wager.status}</span></p>
            <p className="mt-1 text-[10px] text-muted">{wager.sport.toUpperCase()}{wager.conference ? ` · ${wager.conference}` : ""} · {wager.betTypeLabel} · {wager.sportsbook} · placed {when(wager.placedAt)}{wager.startsAt && wager.status === "open" ? ` · starts ${when(wager.startsAt)}` : ""}</p>
            <ul className="mt-2 space-y-1">{wager.legs.map((leg) => <li key={leg.id} className="flex flex-wrap items-center gap-x-2 text-[11px] text-[#a2abad]">
              {wager.legs.length > 1 && <span className={`h-1.5 w-1.5 rounded-full ${leg.status === "won" ? "bg-lime" : leg.status === "lost" ? "bg-rose-400" : leg.status === "open" ? "bg-amber-300" : "bg-slate-400"}`} />}
              <span>{wager.legs.length > 1 ? `${leg.label} (${american(leg.oddsAmerican)})` : leg.event}</span>
              {leg.resultNote && <span className="text-muted">· {leg.resultNote}</span>}
              {leg.closingAmerican !== null && <span className="text-muted">· closed {american(leg.closingAmerican)}</span>}
            </li>)}</ul>
          </div>
          <div className="text-right text-xs">
            <p className="font-display text-sm font-bold">{american(wager.oddsAmerican)}</p>
            <p className="mt-1 text-muted">{usd(wager.stake)} · {wager.units.toFixed(2)}u</p>
            {wager.status === "open" ? <p className="mt-1 text-muted">To pay <span className="font-semibold text-white">{usd(wager.potentialPayout)}</span></p>
              : <p className={`mt-1 font-semibold ${wager.profitLoss > 0 ? "text-lime" : wager.profitLoss < 0 ? "text-rose-400" : "text-muted"}`}>{wager.profitLoss > 0 ? "+" : ""}{usd(wager.profitLoss)}</p>}
            {(wager.evPct !== null || wager.clvPct !== null) && <p className="mt-1 text-[10px] text-muted">{wager.evPct !== null ? `EV ${wager.evPct >= 0 ? "+" : ""}${wager.evPct.toFixed(1)}%` : ""}{wager.evPct !== null && wager.clvPct !== null ? " · " : ""}{wager.clvPct !== null ? `CLV ${wager.clvPct >= 0 ? "+" : ""}${wager.clvPct.toFixed(1)}%` : ""}</p>}
          </div>
        </div>
        {(wager.canVoid || wager.canSettle) && <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          {wager.canVoid && <button type="button" disabled={busy === wager.id} onClick={() => void run(wager.id, async () => { await api.voidWager(wager.id); return "Wager cancelled. The stake is back in your bankroll."; })} className="rounded-md border border-line px-2.5 py-1.5 hover:border-rose-400 hover:text-rose-300 disabled:opacity-50">Cancel &amp; refund</button>}
          {wager.canSettle && <><span className="text-muted">{wager.betType === "future" ? "Futures settle when the market is decided:" : "Not graded automatically. Settle as:"}</span>
            {(["won", "lost", "push"] as const).map((result) => <button key={result} type="button" disabled={busy === wager.id} onClick={() => void run(wager.id, async () => { await api.settleWager(wager.id, result); return `Wager settled as ${result}.`; })} className="rounded-md border border-line px-2.5 py-1.5 capitalize hover:border-lime hover:text-lime disabled:opacity-50">{result}</button>)}</>}
        </div>}
      </li>)}</ul>}
  </div>;
}
