import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDown, ArrowUp, BrainCircuit, CircleDollarSign, Clock3, RefreshCw,
  ShieldAlert, Sparkles, Target, Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import type { Bet, OddsMovement, ResearchData, ResearchQuote } from "../lib/types";

type View = "Best odds" | "Positive EV" | "Arbitrage" | "Player props" | "Line movement";
const views: View[] = ["Best odds", "Positive EV", "Arbitrage", "Player props", "Line movement"];
const sports = [
  { label: "NBA", key: "basketball_nba" },
  { label: "NFL", key: "americanfootball_nfl" },
  { label: "MLB", key: "baseball_mlb" },
  { label: "NHL", key: "icehockey_nhl" },
];
const money = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;

export function MarketLab({ onTrack, onGraded }: { onTrack: (bet: Partial<Bet>) => void; onGraded: () => void }) {
  const [view, setView] = useState<View>("Best odds");
  const [sport, setSport] = useState(sports[0]!.key);
  const [includeProps, setIncludeProps] = useState(false);
  const [data, setData] = useState<ResearchData | null>(null);
  const [movements, setMovements] = useState<OddsMovement[]>([]);
  const [risk, setRisk] = useState<{ bankroll: { current_bankroll: string; unit_size: string }; openStake: number; availableRiskBudget: number } | null>(null);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [marketFilter, setMarketFilter] = useState("all");
  const [bookFilter, setBookFilter] = useState("all");
  const [modelMessage, setModelMessage] = useState("");
  const [gradeMessage, setGradeMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [marketData, movementData, riskData, modelData] = await Promise.all([
        api.odds(sport, includeProps),
        api.oddsMovement(),
        api.oddsRisk(),
        api.oddsModel(),
      ]);
      setData(marketData);
      setMovements(movementData.movements);
      setRisk(riskData);
      setModelMessage(modelData.message);
      setLoadedAt(new Date());
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not load market research");
    } finally {
      setBusy(false);
    }
  }, [includeProps, sport]);

  useEffect(() => { void refresh(); }, [refresh]);

  const positiveEv = useMemo(() => (data?.lines ?? [])
    .filter((line) => line.fairProbability !== null && line.bookCount >= 2 && line.expectedValue !== null && line.expectedValue > 0)
    .sort((a, b) => (b.expectedValue ?? 0) - (a.expectedValue ?? 0)), [data]);
  const props = useMemo(() => (data?.lines ?? []).filter((line) => line.market.startsWith("player_")), [data]);
  const availableBooks = useMemo(() => [...new Set((data?.quotes ?? []).map((line) => line.sportsbook))].sort(), [data]);

  const filteredLines = useMemo(() => {
    let lines = view === "Positive EV" ? positiveEv : view === "Player props" ? props : data?.lines ?? [];
    if (view === "Player props") lines = props;
    return lines.filter((line) =>
      (marketFilter === "all" || line.market === marketFilter) &&
      (bookFilter === "all" || line.sportsbook === bookFilter) &&
      (!dateFilter || line.commenceTime.slice(0, 10) === dateFilter) &&
      (!search || `${line.event} ${line.outcome} ${line.sportsbook}`.toLowerCase().includes(search.toLowerCase())),
    );
  }, [bookFilter, data, dateFilter, marketFilter, positiveEv, props, search, view]);

  const allocations = useMemo(() => {
    const budget = risk?.availableRiskBudget ?? 0;
    const rows = positiveEv.map((line) => {
      const probability = line.fairProbability ?? 0;
      const fullKelly = line.decimalOdds > 1 ? Math.max(0, (probability * line.decimalOdds - 1) / (line.decimalOdds - 1)) : 0;
      return { key: quoteKey(line), raw: Number(risk?.bankroll.current_bankroll ?? 0) * fullKelly * 0.25 };
    });
    const total = rows.reduce((sum, row) => sum + row.raw, 0);
    const scale = total > budget && total > 0 ? budget / total : 1;
    return new Map(rows.map((row) => [row.key, row.raw * scale]));
  }, [positiveEv, risk]);

  async function autoGrade() {
    setGradeMessage("");
    try {
      const result = await api.gradeBets();
      setGradeMessage(result.message ?? `Graded ${result.graded} bets; ${result.pending} remain pending.`);
      onGraded();
    } catch (issue) {
      setGradeMessage(issue instanceof Error ? issue.message : "Automatic grading failed.");
    }
  }

  const oddsAvailable = data?.source === "The Odds API";
  return (
    <section>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] font-bold tracking-[0.17em] text-lime">SHARPSTATS RESEARCH</p>
          <h2 className="font-display text-2xl font-extrabold">Market lab</h2>
          <p className="mt-1.5 text-sm text-muted">Live market consensus, line intelligence and risk-aware pricing.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Select sport" value={sport} onChange={(event) => setSport(event.target.value)} className="rounded-xl border border-line bg-panel px-3 py-2.5 text-xs">
            {sports.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <button onClick={() => void refresh()} disabled={busy} className="flex items-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-xs font-bold text-[#11170c] disabled:opacity-60">
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} />{busy ? "Scanning..." : "Refresh markets"}
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Market selections" value={data ? String(data.lineCount) : "—"} note={data?.source === "The Odds API" ? "Best price per selection" : "Connect an odds provider"} icon={<Activity size={17} />} />
        <Metric label="Positive EV" value={data ? String(positiveEv.length) : "—"} note="2+ book consensus required" icon={<Target size={17} />} />
        <Metric label="Arbitrage" value={data ? String(data.arbitrage.length) : "—"} note="Best available prices" icon={<Zap size={17} />} />
        <Metric label="Personal model" value={data?.model.status === "trained" ? `${data.model.sampleSize} bets` : `${data?.model.sampleSize ?? 0}/${data?.model.minimumSampleSize ?? 50}`} note={data?.model.status === "trained" ? "Odds calibration active" : "Settled bets to activate"} icon={<BrainCircuit size={17} />} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="flex items-center gap-3 rounded-2xl border border-[#35412a] bg-[#171e16] p-4">
          <div className="rounded-xl bg-lime/10 p-2.5 text-lime"><Sparkles size={18} /></div>
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold">Model transparency</p><p className="mt-1 text-[11px] leading-relaxed text-muted">{modelMessage || "Market probabilities are estimated from multi-book no-vig consensus. EV and Kelly sizes are shown only when the available sample supports them."}</p></div>
          {data?.model.status === "trained" && data.model.brierScore !== null && <div className="hidden text-right sm:block"><p className="text-[9px] text-muted">IN-SAMPLE BRIER</p><p className="mt-1 text-sm font-bold text-lime">{data.model.brierScore.toFixed(3)}</p></div>}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-panel p-4">
          <div><p className="text-[10px] text-muted">PORTFOLIO RISK BUDGET</p><p className="mt-1 font-display text-xl font-bold">{money(risk?.availableRiskBudget ?? 0)}</p><p className="mt-1 text-[10px] text-muted">5% cap less open exposure</p></div>
          <button onClick={() => void autoGrade()} className="rounded-lg border border-line px-3 py-2 text-[10px] font-semibold hover:border-lime hover:text-lime">Grade settled</button>
        </div>
      </div>
      {gradeMessage && <p className="mb-4 rounded-lg border border-line bg-panel px-4 py-3 text-xs text-muted">{gradeMessage}</p>}
      {error && <div className="mb-4 rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">{error}<button onClick={() => void refresh()} className="ml-3 underline">Retry</button></div>}

      <div className="overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <div className="flex flex-wrap gap-1">
            {views.map((item) => <button key={item} onClick={() => setView(item)} className={`rounded-lg px-3 py-2 text-[10px] font-semibold transition ${view === item ? "bg-[#27312a] text-lime" : "text-muted hover:text-white"}`}>{item}{item === "Positive EV" && positiveEv.length > 0 && <span className="ml-1.5 rounded bg-lime/10 px-1 text-lime">{positiveEv.length}</span>}</button>)}
          </div>
          <span className="text-[10px] text-muted">{loadedAt ? `Updated ${loadedAt.toLocaleTimeString()}` : "Awaiting market scan"}</span>
        </div>
        {view === "Arbitrage" ? <ArbitrageTable opportunities={data?.arbitrage ?? []} /> :
          view === "Line movement" ? <MovementTable movements={movements} onRefresh={() => void refresh()} /> :
            <div>
              <div className="flex flex-wrap gap-2 border-b border-line p-3">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search events, players, books..." className="min-w-[180px] flex-1 rounded-lg border border-line bg-[#0c1114] px-3 py-2 text-xs outline-none focus:border-lime" />
                <input aria-label="Filter by date" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="rounded-lg border border-line bg-[#0c1114] px-3 py-2 text-xs text-muted" />
                <select aria-label="Filter market" value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)} className="rounded-lg border border-line bg-[#0c1114] px-3 py-2 text-xs"><option value="all">All markets</option>{[...new Set((data?.lines ?? []).map((line) => line.market))].sort().map((market) => <option key={market} value={market}>{marketLabel(market)}</option>)}</select>
                <select aria-label="Filter sportsbook" value={bookFilter} onChange={(event) => setBookFilter(event.target.value)} className="rounded-lg border border-line bg-[#0c1114] px-3 py-2 text-xs"><option value="all">All books</option>{availableBooks.map((book) => <option key={book}>{book}</option>)}</select>
                <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[10px] text-muted"><input type="checkbox" checked={includeProps} onChange={(event) => setIncludeProps(event.target.checked)} className="accent-lime" />Include player props</label>
              </div>
              <MarketTable
                lines={filteredLines}
                showEv={view === "Positive EV" || view === "Player props"}
                allocations={allocations}
                onTrack={(line) => onTrack(toBet(line))}
              />
            </div>}
        {!oddsAvailable && !error && <div className="border-t border-line px-5 py-3 text-[10px] text-muted">{data?.source === "provider_empty" ? "No events currently returned for this sport. Try another league or refresh later." : "Live odds require ODDS_API_KEY in the project .env; no sample prices are presented as live market data."}</div>}
      </div>
      <div className="mt-4 flex items-start gap-2 text-[10px] leading-relaxed text-muted"><ShieldAlert size={14} className="mt-0.5 shrink-0 text-amber-400" /><span>Prices, consensus probabilities and Kelly allocations are estimates—not betting advice. Market data can be delayed, incomplete, or unavailable; verify every price with the sportsbook.</span></div>
    </section>
  );
}

function quoteKey(line: ResearchQuote): string {
  return `${line.eventId}|${line.market}|${line.point ?? ""}|${line.outcome}`;
}

function toBet(line: ResearchQuote): Partial<Bet> {
  const betType = line.market.startsWith("player_") ? "Player Props" :
    line.market === "spreads" ? "Spread" : line.market === "totals" ? "Over/Under" : "Moneyline";
  return {
    sport: line.sport,
    league: line.sport,
    event: line.event,
    bet_type: betType,
    team_player: line.outcome,
    selection: line.outcome,
    odds: line.decimalOdds,
    sportsbook: line.sportsbook,
    market_key: line.market,
    line_value: line.point ?? null,
    event_id: line.eventId,
    closing_odds: null,
  };
}

function Metric({ label, value, note, icon }: { label: string; value: string; note: string; icon: ReactNode }) {
  return <div className="rounded-2xl border border-line bg-panel p-4"><div className="flex items-center justify-between text-muted"><span className="text-[10px]">{label}</span><span className="text-lime">{icon}</span></div><p className="mt-3 font-display text-2xl font-bold">{value}</p><p className="mt-1 text-[10px] text-muted">{note}</p></div>;
}

function MarketTable({ lines, showEv, allocations, onTrack }: { lines: ResearchQuote[]; showEv: boolean; allocations: Map<string, number>; onTrack: (line: ResearchQuote) => void }) {
  if (!lines.length) return <EmptyState text="No matching live quotes. Configure a provider key, choose another sport, or refresh markets." />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[1020px] text-left"><thead><tr className="text-[9px] tracking-wider text-muted"><th className="px-5 py-3">EVENT / PICK</th><th className="px-3 py-3">MARKET</th><th className="px-3 py-3">BEST BOOK</th><th className="px-3 py-3">ODDS</th><th className="px-3 py-3">NO-VIG FAIR</th><th className="px-3 py-3">MODEL P</th>{showEv && <><th className="px-3 py-3">EDGE / EV</th><th className="px-3 py-3">¼ KELLY</th></>}<th className="px-3 py-3">MOVE</th><th className="px-5 py-3"></th></tr></thead><tbody>{lines.slice(0, 250).map((line) => {
    const edge = line.expectedValue;
    const delta = line.movement;
    return <tr key={quoteKey(line)} className="border-t border-line text-xs">
      <td className="px-5 py-3.5"><p className="font-medium">{line.event}</p><p className="mt-1 text-[10px] text-muted">{line.outcome} · {new Date(line.commenceTime).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</p></td>
      <td className="px-3 py-3.5"><span className="rounded-md bg-[#20292e] px-2 py-1 text-[9px] text-muted">{marketLabel(line.market)}{line.point !== undefined ? ` ${line.point}` : ""}</span></td>
      <td className="px-3 py-3.5">{line.sportsbook}</td><td className="px-3 py-3.5 font-bold text-lime">{line.decimalOdds.toFixed(2)}</td>
      <td className="px-3 py-3.5">{line.fairProbability === null ? <span className="text-muted">Need paired market</span> : <span>{(line.fairProbability * 100).toFixed(1)}% <span className="text-[9px] text-muted">· {line.bookCount} books</span></span>}</td>
      <td className="px-3 py-3.5">{line.calibratedProbability === null ? <span className="text-muted">Need 50+ bets</span> : <span className="text-sky-300">{(line.calibratedProbability * 100).toFixed(1)}%</span>}</td>
      {showEv && <><td className={`px-3 py-3.5 ${edge !== null && edge > 0 ? "text-lime" : "text-muted"}`}>{edge === null || line.bookCount < 2 ? "—" : pct(edge)}</td><td className="px-3 py-3.5 text-muted">{allocations.has(quoteKey(line)) ? money(allocations.get(quoteKey(line))!) : "—"}</td></>}
      <td className="px-3 py-3.5">{delta === null ? <span className="text-muted">Collecting</span> : <span className={delta > 0 ? "text-lime" : delta < 0 ? "text-rose-400" : "text-muted"}>{delta > 0 ? <ArrowUp className="inline" size={12} /> : delta < 0 ? <ArrowDown className="inline" size={12} /> : null} {delta > 0 ? "+" : ""}{delta.toFixed(2)}</span>}</td>
      <td className="px-5 py-3.5 text-right"><button onClick={() => onTrack(line)} className="rounded-md border border-line px-2.5 py-1.5 text-[10px] hover:border-lime hover:text-lime">Track</button></td>
    </tr>;
  })}</tbody></table></div>;
}

function ArbitrageTable({ opportunities }: { opportunities: ResearchData["arbitrage"] }) {
  if (!opportunities.length) return <EmptyState text="No arbitrage opportunities in the current snapshot. Arbitrage checks require both sides of a market across available books." />;
  return <div className="space-y-3 p-4">{opportunities.map((item, index) => <div key={`${item.event}-${item.market}-${index}`} className="rounded-xl border border-line bg-[#0c1114] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{item.event}</p><p className="mt-1 text-[10px] text-muted">{marketLabel(item.market)}{item.point !== null ? ` · ${item.point}` : ""}</p></div><span className="rounded-lg bg-lime/10 px-3 py-1.5 text-xs font-bold text-lime">{((1 - item.overround) * 100).toFixed(2)}% theoretical margin</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{item.legs.map((leg) => <div key={`${leg.outcome}-${leg.sportsbook}`} className="flex items-center justify-between rounded-lg border border-line p-3 text-xs"><div><p className="font-semibold">{leg.outcome} · {leg.sportsbook}</p><p className="mt-1 text-[10px] text-muted">Suggested split {(leg.stakeFraction * 100).toFixed(1)}%</p></div><p className="font-bold text-lime">{leg.odds.toFixed(2)}</p></div>)}</div><p className="mt-3 text-[10px] text-muted">Theoretical only; excludes limits, price changes, settlement rules, and execution risk.</p></div>)}</div>;
}

function MovementTable({ movements, onRefresh }: { movements: OddsMovement[]; onRefresh: () => void }) {
  if (!movements.length) return <div className="p-8 text-center"><Clock3 size={22} className="mx-auto text-muted" /><p className="mt-3 text-sm font-semibold">Building your line history</p><p className="mx-auto mt-1 max-w-md text-xs text-muted">Refresh live markets at different times to compare observed prices. Historical snapshots begin after the first scan.</p><button onClick={onRefresh} className="mt-4 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-lime mx-auto"><RefreshCw size={13} />Take a snapshot</button></div>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="text-[9px] tracking-wider text-muted"><th className="px-5 py-3">MARKET / PICK</th><th className="px-3 py-3">BOOK</th><th className="px-3 py-3">OPEN</th><th className="px-3 py-3">HIGH</th><th className="px-3 py-3">LATEST</th><th className="px-3 py-3">MOVE</th><th className="px-5 py-3">SAMPLES</th></tr></thead><tbody>{movements.map((item) => { const change = Number(item.latest_odds) - Number(item.opening_odds); return <tr key={`${item.event_id}-${item.market}-${item.point}-${item.outcome}-${item.sportsbook}`} className="border-t border-line text-xs"><td className="px-5 py-3.5"><p>{item.event}</p><p className="mt-1 text-[10px] text-muted">{marketLabel(item.market)} · {item.outcome}</p></td><td className="px-3 py-3.5">{item.sportsbook}</td><td className="px-3 py-3.5">{Number(item.opening_odds).toFixed(2)}</td><td className="px-3 py-3.5">{Number(item.high_odds).toFixed(2)}</td><td className="px-3 py-3.5 font-semibold">{Number(item.latest_odds).toFixed(2)}</td><td className={change >= 0 ? "px-3 py-3.5 text-lime" : "px-3 py-3.5 text-rose-400"}>{change >= 0 ? "+" : ""}{change.toFixed(2)}</td><td className="px-5 py-3.5 text-muted">{item.observations}</td></tr>; })}</tbody></table></div>;
}

function marketLabel(market: string): string {
  if (market.startsWith("player_")) return market.replace("player_", "").replace(/_/g, " ");
  if (market === "h2h") return "Moneyline";
  if (market === "spreads") return "Spread";
  if (market === "totals") return "Total";
  return market;
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-6 py-14 text-center"><CircleDollarSign size={23} className="mx-auto text-muted" /><p className="mx-auto mt-3 max-w-lg text-xs leading-relaxed text-muted">{text}</p></div>;
}
