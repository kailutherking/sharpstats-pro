import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ReceiptText, Trash2, X } from "lucide-react";
import { api } from "../../lib/api";
import { useBetSlip } from "../../lib/betSlipStore";
import { american } from "../../lib/oddsFormat";
import type { SlipLeg, SlipRequest } from "../../lib/simTypes";

const usd = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const stakeOf = (text: string) => { const value = Number(text); return Number.isFinite(value) && value > 0 ? value : undefined; };

function toRequest(legs: SlipLeg[], mode: "single" | "parlay", parlayStake: string): SlipRequest {
  return {
    mode,
    stake: mode === "parlay" ? stakeOf(parlayStake) : undefined,
    legs: legs.map((leg) => leg.kind === "future"
      ? { kind: "future" as const, marketId: leg.marketId ?? "", outcome: leg.outcome ?? "", american: leg.american, stake: mode === "single" ? stakeOf(leg.stake) : undefined }
      : { kind: "market" as const, sport: leg.sport, gameId: leg.gameId ?? "", selectionId: leg.selectionId ?? "", book: leg.book, american: leg.american, stake: mode === "single" ? stakeOf(leg.stake) : undefined }),
  };
}

/** Queries that change when a simulated wager is placed, cancelled or graded. */
export const SIM_QUERY_KEYS = ["summary", "performance", "bets", "open-bets", "sim-bets", "sim-analytics", "bankroll-history"];

/** Floating bet slip for simulated wagers. Stakes come out of the simulated bankroll; no real money is involved. */
export function BetSlip() {
  const { legs, mode, parlayStake, open, remove, setStake, setPrices, setParlayStake, setMode, setOpen, clear } = useBetSlip();
  const queryClient = useQueryClient();
  const [placed, setPlaced] = useState<string | null>(null);
  const [error, setError] = useState("");
  const effectiveMode = legs.length < 2 ? "single" : mode;
  const request = useMemo(() => toRequest(legs, effectiveMode, parlayStake), [legs, effectiveMode, parlayStake]);
  // Typing a stake should not fire a request per keystroke.
  const [debounced, setDebounced] = useState(request);
  useEffect(() => { const timer = setTimeout(() => setDebounced(request), 400); return () => clearTimeout(timer); }, [request]);
  const quoteQuery = useQuery({
    queryKey: ["slip-quote", debounced],
    queryFn: () => api.quoteSlip(debounced),
    enabled: open && debounced.legs.length > 0,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    retry: false,
  });
  const quote = legs.length ? quoteQuery.data : undefined;
  const quoteError = legs.length && quoteQuery.error instanceof Error ? quoteQuery.error.message : "";
  const pricedLegs = quote?.wagers.flatMap((wager) => wager.legs) ?? [];
  const changed = pricedLegs.filter((leg) => leg.changed);

  const place = useMutation({
    mutationFn: () => api.placeSlip(request),
    onSuccess: (result) => {
      setPlaced(`${result.wagerIds.length === 1 ? "Wager" : `${result.wagerIds.length} wagers`} placed · ${usd(result.quote.totalStake)} staked to win ${usd(result.quote.totalPayout - result.quote.totalStake)}. ${usd(result.bankroll.available)} available.`);
      setError("");
      clear();
      for (const key of SIM_QUERY_KEYS) void queryClient.invalidateQueries({ queryKey: [key] });
    },
    onError: (issue) => { setError(issue instanceof Error ? issue.message : "Could not place the wager"); void quoteQuery.refetch(); },
  });

  function acceptPrices() {
    setPrices(pricedLegs.map((leg) => ({ key: legs[leg.index]?.key ?? "", american: leg.american })));
    setError("");
  }

  const ready = Boolean(quote && !quote.problems.length && !changed.length && !quoteQuery.isFetching && quote.totalStake > 0);
  const count = legs.length;
  return <>
    <button type="button" onClick={() => { setOpen(true); setPlaced(null); }} aria-label={`Open bet slip (${count} selection${count === 1 ? "" : "s"})`}
      className="fixed bottom-[72px] right-4 z-30 flex items-center gap-2 rounded-full border border-[#3b4a2c] bg-[#1a2118] px-4 py-3 text-xs font-bold text-lime shadow-2xl hover:bg-[#222c1e] lg:bottom-6 lg:right-6">
      <ReceiptText size={16} />Bet slip{count > 0 && <span className="rounded-full bg-lime px-1.5 py-0.5 text-[10px] text-[#11170c]">{count}</span>}
    </button>
    {open && <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Simulated bet slip">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close bet slip" onClick={() => setOpen(false)} />
      <div className="relative flex h-full w-full max-w-[420px] flex-col border-l border-line bg-[#0e1316] text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div><p className="text-sm font-semibold">Bet slip</p><p className="mt-0.5 text-[10px] font-bold tracking-wider text-amber-300">SIMULATED · NO REAL MONEY</p></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-white"><X size={17} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {placed && <div className="mb-4 flex gap-2 rounded-xl border border-[#3b4a2c] bg-[#1a2118] p-3 text-xs text-[#d6e6c0]"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-lime" /><span>{placed} Track it under Bet tracker → Simulated wagers.</span></div>}
          {!count && !placed && <p className="rounded-xl border border-dashed border-line p-6 text-center text-xs leading-relaxed text-muted">Your slip is empty. On the Odds screen, use the slip button next to any price to add a selection, then set a stake here.</p>}
          {count > 0 && <>
            <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-line bg-[#0c1114] p-1 text-xs">
              {(["single", "parlay"] as const).map((value) => <button key={value} type="button" disabled={value === "parlay" && count < 2} onClick={() => setMode(value)} aria-pressed={effectiveMode === value}
                className={`rounded-md py-2 font-semibold disabled:opacity-40 ${effectiveMode === value ? "bg-[#202b24] text-lime" : "text-muted hover:text-white"}`}>{value === "single" ? `Singles (${count})` : quote?.slipType === "sgp" && effectiveMode === "parlay" ? "Same game parlay" : "Parlay"}</button>)}
            </div>
            <ul className="space-y-2">{legs.map((leg, index) => {
              const priced = pricedLegs.find((item) => item.index === index);
              const wager = effectiveMode === "single" ? quote?.wagers[index] : undefined;
              return <li key={leg.key} className="rounded-xl border border-line bg-[#131a1d] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="text-xs font-semibold leading-snug">{leg.label}</p><p className="mt-1 truncate text-[10px] text-muted">{leg.event}</p><p className="mt-0.5 text-[10px] text-muted">{leg.bookName}{priced?.live ? " · live price" : ""}</p></div>
                  <div className="flex shrink-0 items-center gap-2"><span className="font-display text-sm font-bold">{american(leg.american)}</span><button type="button" onClick={() => remove(leg.key)} aria-label={`Remove ${leg.label}`} className="rounded-md p-1 text-muted hover:bg-white/5 hover:text-rose-300"><Trash2 size={13} /></button></div>
                </div>
                {priced?.changed && <p className="mt-2 text-[10px] text-amber-300">Price moved to {american(priced.american)}.</p>}
                {effectiveMode === "single" && <div className="mt-3 flex items-center gap-2">
                  <label className="flex flex-1 items-center gap-2 rounded-lg border border-line bg-[#0c1114] px-3 py-2 text-xs text-muted">Stake $<input inputMode="decimal" value={leg.stake} onChange={(event) => setStake(leg.key, event.target.value)} placeholder="0.00" aria-label={`Stake for ${leg.label}`} className="w-full bg-transparent text-right text-sm text-white outline-none" /></label>
                  <div className="w-[104px] text-right text-[10px] text-muted">To win<p className="text-sm font-semibold text-white">{wager && wager.stake > 0 ? usd(wager.profit) : "—"}</p></div>
                </div>}
              </li>;
            })}</ul>
            {effectiveMode === "parlay" && <label className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-[#0c1114] px-3 py-2.5 text-xs text-muted">Parlay stake $<input inputMode="decimal" value={parlayStake} onChange={(event) => setParlayStake(event.target.value)} placeholder="0.00" aria-label="Parlay stake" className="w-full bg-transparent text-right text-sm text-white outline-none" /></label>}
            {quote && <div className="mt-4 space-y-2 rounded-xl border border-line bg-[#131a1d] p-4 text-xs">
              {effectiveMode === "parlay" && quote.wagers[0] && <Row label={`${quote.wagers[0].legs.length}-leg odds`} value={american(quote.wagers[0].american)} />}
              <Row label="Total stake" value={usd(quote.totalStake)} />
              <Row label="Potential payout" value={usd(quote.totalPayout)} strong />
              <Row label="Risk" value={`${(quote.bankroll.currentBankroll > 0 ? quote.totalStake / quote.bankroll.currentBankroll * 100 : 0).toFixed(1)}% of bankroll · ${(quote.totalStake / quote.bankroll.unitSize).toFixed(2)}u`} />
              {quote.wagers.length === 1 && quote.wagers[0]!.evPct !== null && <Row label="Expected value" value={`${quote.wagers[0]!.evPct! >= 0 ? "+" : ""}${quote.wagers[0]!.evPct!.toFixed(1)}% vs no-vig price`} />}
              <Row label="Available bankroll" value={`${usd(quote.bankroll.available)} → ${usd(Math.max(0, quote.availableAfter))}`} />
              {quote.notes.map((note) => <p key={note} className="pt-1 text-[10px] leading-relaxed text-muted">{note}</p>)}
            </div>}
            {changed.length > 0 && <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200"><span>Odds changed on {changed.length} selection{changed.length === 1 ? "" : "s"}.</span><button type="button" onClick={acceptPrices} className="rounded-md border border-amber-700 px-2.5 py-1.5 font-semibold hover:bg-amber-900/30">Accept new odds</button></div>}
            {[...(quote?.problems ?? []), quoteError, error].filter((text, index, all) => text && all.indexOf(text) === index && !(text.startsWith("Enter a stake") && !quote?.totalStake)).map((text) => <p key={text} className="mt-3 rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">{text}</p>)}
          </>}
        </div>
        {count > 0 && <div className="border-t border-line px-5 py-4">
          <button type="button" disabled={!ready || place.isPending} onClick={() => place.mutate()} className="w-full rounded-xl bg-lime py-3 text-sm font-bold text-[#11170c] disabled:opacity-50">{place.isPending ? "Placing…" : quote && quote.totalStake > 0 ? `Place simulated ${effectiveMode === "parlay" ? "parlay" : count === 1 ? "bet" : "bets"} · ${usd(quote.totalStake)}` : "Enter a stake"}</button>
          <button type="button" onClick={clear} className="mt-2 w-full py-1.5 text-[11px] text-muted hover:text-white">Clear slip</button>
        </div>}
      </div>
    </div>}
  </>;
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-muted">{label}</span><span className={`text-right ${strong ? "font-display text-base font-bold text-lime" : "font-semibold"}`}>{value}</span></div>;
}
