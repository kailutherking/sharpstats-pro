import { useMemo, useState } from "react";
import { Scale, ShieldCheck } from "lucide-react";
import type { ArbitrageData, BookInfo, EvData, EvTier } from "../../lib/oddsTypes";
import { american, money, pct, recommendedStake, signedPct, startTime, timeAgo } from "../../lib/oddsFormat";
import { EmptyState, inputClass, LoadingBlock, Panel, Segmented, thClass } from "../stats/StatsUi";
import { BookTag, LiveDot, Notice, RiskBadge, SignalBadges, TierBadge } from "./OddsUi";

function KeyNotice({ keyless }: { keyless: boolean }) {
  if (!keyless) return null;
  return <Notice tone="warn">EV and arbitrage need prices from several sportsbooks. Add <code className="text-white">ODDS_API_KEY</code> (The Odds API) to the server environment to scan DraftKings, FanDuel, BetMGM, Caesars, ESPN BET, Fanatics, BetRivers and Pinnacle.</Notice>;
}

export function EvScanner({ data, books, loading, keyless, onOpen }: { data: EvData | undefined; books: BookInfo[]; loading: boolean; keyless: boolean; onOpen: (selectionId: string) => void }) {
  const [tier, setTier] = useState<EvTier | "all">("all");
  const [minEv, setMinEv] = useState("0.5");
  const rows = useMemo(() => (data?.rows ?? []).filter((row) => (tier === "all" || row.tier === tier) && row.ev * 100 >= (Number(minEv) || 0)), [data, minEv, tier]);
  if (loading && !data) return <LoadingBlock label="Scanning for positive expected value…" />;
  const counts = { positive: 0, strong: 0, elite: 0, ...Object.fromEntries(Object.entries((data?.rows ?? []).reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.tier]: (acc[row.tier] ?? 0) + 1 }), {}))) } as Record<EvTier, number>;
  return (
    <div className="space-y-4">
      <KeyNotice keyless={keyless} />
      <div className="grid gap-3 sm:grid-cols-3">
        {(["positive", "strong", "elite"] as EvTier[]).map((key) => (
          <button key={key} type="button" onClick={() => setTier(tier === key ? "all" : key)} className={`rounded-xl border p-4 text-left ${tier === key ? "border-lime bg-lime/5" : "border-line bg-panel"}`}>
            <TierBadge tier={key} />
            <p className="mt-2 font-display text-2xl font-bold">{counts[key]}</p>
            <p className="text-[10px] text-muted">{key === "positive" ? "0.5% – 3% EV" : key === "strong" ? "3% – 6% EV" : "6%+ EV"}</p>
          </button>
        ))}
      </div>
      <Panel title="Positive EV scanner" subtitle="Each price vs the no-vig fair probability (sharp reference first, then consensus)" flush
        action={<label className="flex items-center gap-2 text-[11px] text-muted">Min EV %<input aria-label="Minimum EV percent" type="number" step="0.5" min="0" value={minEv} onChange={(event) => setMinEv(event.target.value)} className={`${inputClass} w-20`} /></label>}>
        {!rows.length ? <EmptyState>{keyless ? "EV scanning activates with multi-book prices." : "No prices currently beat the fair line at this threshold."}</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-left">
              <thead><tr className={thClass}>
                <th className="px-4 py-3">SELECTION</th><th className="px-3 py-3">GAME</th><th className="px-3 py-3">BOOK</th><th className="px-3 py-3 text-right">ODDS</th>
                <th className="px-3 py-3 text-right">IMPLIED</th><th className="px-3 py-3 text-right">NO-VIG</th><th className="px-3 py-3 text-right">FAIR ODDS</th>
                <th className="px-3 py-3 text-right">EV</th><th className="px-3 py-3 text-right">EDGE</th><th className="px-3 py-3 text-right">KELLY</th><th className="px-3 py-3 text-right">STAKE</th>
                <th className="px-3 py-3">RISK</th><th className="px-4 py-3">RATING</th>
              </tr></thead>
              <tbody>
                {rows.map((row) => {
                  const stake = recommendedStake(row.kelly, data?.sizing);
                  return (
                    <tr key={`${row.selectionId}|${row.book}`} className="border-t border-line text-xs">
                      <td className="px-4 py-2.5"><button type="button" onClick={() => onOpen(row.selectionId)} className="text-left font-medium text-white hover:text-lime">{row.label}</button><span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted">{row.marketLabel}<SignalBadges signals={row.signals} /></span></td>
                      <td className="px-3 py-2.5"><span className="block max-w-[200px] truncate text-[#d9e0dc]">{row.game}</span><span className="flex items-center gap-1.5 text-[10px] text-muted">{row.commenceTime ? startTime(row.commenceTime) : ""}<LiveDot live={row.status === "live"} /></span></td>
                      <td className="px-3 py-2.5"><BookTag book={row.book} books={books} /></td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${row.bestPrice ? "text-lime" : "text-white"}`}>{american(row.american)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{pct(row.implied)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]" title={row.fairSource}>{pct(row.noVigProbability)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{american(row.fairAmerican)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-lime">{signedPct(row.ev, 2)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{signedPct(row.edge)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{data ? pct(Math.min(data.sizing.maxStakeFraction, row.kelly * data.sizing.kellyMultiplier), 2) : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-white">{stake ? money(stake) : "—"}</td>
                      <td className="px-3 py-2.5"><RiskBadge risk={row.risk} /></td>
                      <td className="px-4 py-2.5"><TierBadge tier={row.tier} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {Boolean(data?.history.length) && (
        <Panel title="EV history" subtitle="Edges detected in the last 24 hours and how long they lasted" flush>
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead className="sticky top-0 bg-panel"><tr className={thClass}><th className="px-4 py-3">SELECTION</th><th className="px-3 py-3">BOOK</th><th className="px-3 py-3 text-right">PRICE</th><th className="px-3 py-3 text-right">PEAK EV</th><th className="px-3 py-3 text-right">FIRST SEEN</th><th className="px-4 py-3 text-right">LASTED</th></tr></thead>
              <tbody>
                {data!.history.map((row) => (
                  <tr key={`${row.sideId}-${row.book}-${row.american}-${row.firstSeenAt}`} className="border-t border-line text-xs">
                    <td className="px-4 py-2 text-white">{row.label}</td>
                    <td className="px-3 py-2"><BookTag book={row.book} books={books} compact /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{american(row.american)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-lime">{signedPct(row.peakEv, 2)}</td>
                    <td className="px-3 py-2 text-right text-muted">{timeAgo(row.firstSeenAt)}</td>
                    <td className="px-4 py-2 text-right text-muted">{row.closedAt ? duration(row.durationSeconds) : <span className="text-lime">Active</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

const RATING_STYLE = { strong: "bg-lime text-[#11170c]", solid: "bg-lime/15 text-lime", thin: "bg-amber-400/15 text-amber-300" } as const;

export function ArbitrageScanner({ data, books, loading, keyless, total, onTotal, onOpen }: { data: ArbitrageData | undefined; books: BookInfo[]; loading: boolean; keyless: boolean; total: number; onTotal: (value: number) => void; onOpen: (selectionId: string) => void }) {
  const [view, setView] = useState<"open" | "closed">("open");
  if (loading && !data) return <LoadingBlock label="Scanning every sportsbook for arbitrage…" />;
  const opportunities = data?.opportunities ?? [];
  return (
    <div className="space-y-4">
      <KeyNotice keyless={keyless} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Arbitrage view" value={view} onChange={setView} options={[{ value: "open", label: `Open (${opportunities.length})` }, { value: "closed", label: `Recently closed (${data?.recentlyClosed.length ?? 0})` }]} />
        <label className="flex items-center gap-2 text-[11px] text-muted">Total stake ($)
          <input aria-label="Total arbitrage stake" type="number" min="1" step="10" value={total} onChange={(event) => onTotal(Math.max(1, Number(event.target.value) || 100))} className={`${inputClass} w-28`} />
        </label>
      </div>
      {view === "open" ? (
        !opportunities.length ? <Panel><EmptyState>{keyless ? "Arbitrage scanning activates with multi-book prices." : "No arbitrage across connected sportsbooks right now. The scanner re-checks on every refresh."}</EmptyState></Panel> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {opportunities.map((item) => (
              <section key={item.id} className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold"><Scale size={15} className="text-amber-300" />{item.marketLabel}{item.participant ? ` · ${item.participant}` : ""}</p>
                    <p className="mt-1 truncate text-[11px] text-muted">{item.game}{item.commenceTime ? ` · ${startTime(item.commenceTime)}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-2xl font-bold text-lime">{pct(item.profitPct, 2)}</p>
                    <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ${RATING_STYLE[item.rating]}`}>{item.rating}</span>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {item.legs.map((leg, index) => (
                    <button key={leg.selectionId} type="button" onClick={() => onOpen(leg.selectionId)} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-line bg-[#0e1416] px-3 py-2.5 text-left text-xs hover:border-[#34412a] sm:grid-cols-[1fr_auto_auto_auto]">
                      <span className="min-w-0"><span className="block truncate font-medium text-white">{leg.label}</span><span className="mt-0.5 block"><BookTag book={leg.book} books={books} /></span></span>
                      <span className="text-right font-semibold tabular-nums text-lime">{american(leg.american)}</span>
                      <span className="col-span-2 flex justify-between gap-4 text-[11px] text-muted sm:col-span-1 sm:block sm:text-right"><span className="sm:block">Stake</span><span className="font-semibold text-white">{money(item.stakes[index]?.stake ?? 0)}</span></span>
                      <span className="col-span-2 flex justify-between gap-4 text-[11px] text-muted sm:col-span-1 sm:block sm:text-right"><span className="sm:block">Returns</span><span className="text-white">{money(item.stakes[index]?.payout ?? 0)}</span></span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
                  <div className="rounded-lg border border-line p-2.5"><p className="text-muted">Guaranteed return</p><p className="mt-1 font-semibold text-white">{money(total * (1 + item.profitPct))}</p></div>
                  <div className="rounded-lg border border-line p-2.5"><p className="text-muted">Profit</p><p className="mt-1 font-semibold text-lime">{money(item.guaranteedProfit)}</p></div>
                  <div className="rounded-lg border border-line p-2.5"><p className="text-muted">Books needed</p><p className="mt-1 font-semibold text-white">{item.books.length}</p></div>
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted"><ShieldCheck size={12} />Open {timeAgo(item.firstSeenAt)} · oldest leg updated {timeAgo(item.oldestLegAt)} · confirm both prices before placing</p>
              </section>
            ))}
          </div>
        )
      ) : (
        <Panel title="Recently closed arbitrage" subtitle="Windows that existed in the last 24 hours" flush>
          {!data?.recentlyClosed.length ? <EmptyState>No arbitrage windows closed in the last 24 hours.</EmptyState> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left">
                <thead><tr className={thClass}><th className="px-4 py-3">MARKET</th><th className="px-3 py-3">BOOKS</th><th className="px-3 py-3 text-right">PEAK PROFIT</th><th className="px-3 py-3 text-right">CLOSED</th><th className="px-4 py-3 text-right">LASTED</th></tr></thead>
                <tbody>
                  {data.recentlyClosed.map((row) => (
                    <tr key={row.signature} className="border-t border-line text-xs">
                      <td className="px-4 py-2 text-white">{row.market}{row.participant ? ` · ${row.participant}` : ""}</td>
                      <td className="px-3 py-2"><span className="flex gap-1">{row.books.map((book) => <BookTag key={book} book={book} books={books} compact />)}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums text-lime">{pct(row.peakProfitPct, 2)}</td>
                      <td className="px-3 py-2 text-right text-muted">{timeAgo(row.closedAt)}</td>
                      <td className="px-4 py-2 text-right text-muted">{duration(row.durationSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
