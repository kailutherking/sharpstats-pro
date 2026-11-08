import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Flame, Repeat, X, Zap } from "lucide-react";
import { api } from "../../lib/api";
import type { BookInfo, MovementData, OddsSport, Selection } from "../../lib/oddsTypes";
import { american, bookShort, lineMoveText, pct, priceLine, signedPct, timeAgo } from "../../lib/oddsFormat";
import { EmptyState, LoadingBlock, Panel, Segmented, thClass } from "../stats/StatsUi";
import { BookTag, MoveIndicator, SignalBadges } from "./OddsUi";

const COLORS = ["#c5f467", "#7dd3fc", "#fbbf24", "#f0abfc", "#fb7185", "#34d399", "#a5b4fc", "#fdba74", "#93c5fd", "#e879f9"];
const tooltipStyle = { background: "#11171b", border: "1px solid #29343a", borderRadius: 12, color: "#eef2ed", fontSize: 12 };
const axis = { axisLine: false, tickLine: false, tick: { fill: "#849198", fontSize: 10 } };

const RANGE_LABELS: Record<string, string> = { best: "Best price", worst: "Worst price", average: "Market average", fair: "Fair (no-vig)" };

function impliedFromAmerican(value: number): number {
  return value > 0 ? 100 / (value + 100) : Math.abs(value) / (Math.abs(value) + 100);
}

/** Drawer with the price history of one selection across books, plus open / current / peak / low per book. */
export function LineHistoryDrawer({ sport, selection, books, onClose }: { sport: OddsSport; selection: Selection; books: BookInfo[]; onClose: () => void }) {
  const history = useQuery({ queryKey: ["odds-history", sport, selection.id], queryFn: () => api.oddsHistory(sport, selection.id), refetchInterval: 30_000 });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [view, setView] = useState<"books" | "range">("books");
  const live = history.data?.selection ?? selection;
  const range = useMemo(() => {
    const rows = (history.data?.range ?? []).map((point) => ({
      at: point.at,
      label: new Date(point.at).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }),
      best: Math.round(impliedFromAmerican(point.bestAmerican) * 1000) / 10,
      worst: point.worstAmerican === null ? null : Math.round(impliedFromAmerican(point.worstAmerican) * 1000) / 10,
      average: point.averageImplied === null ? null : Math.round(point.averageImplied * 1000) / 10,
      fair: point.fairProbability === null ? null : Math.round(point.fairProbability * 1000) / 10,
      bestLabel: `${american(point.bestAmerican)} ${bookShort(point.bestBook)}`,
      worstLabel: point.worstAmerican === null ? "—" : `${american(point.worstAmerican)} ${point.worstBook ? bookShort(point.worstBook) : ""}`,
    }));
    if (rows.length) rows.push({ ...rows[rows.length - 1]!, at: new Date().toISOString(), label: "Now" });
    return rows;
  }, [history.data]);
  const chart = useMemo(() => {
    const points = history.data?.points ?? [];
    const bookKeys = [...new Set(points.map((point) => point.book))];
    const times = [...new Set(points.map((point) => point.at))].sort();
    const last = new Map<string, number>();
    const rows = times.map((at) => {
      for (const point of points.filter((item) => item.at === at)) last.set(point.book, Math.round(impliedFromAmerican(point.american) * 1000) / 10);
      return { at, label: new Date(at).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }), ...Object.fromEntries([...last.entries()]) };
    });
    const now = new Date().toISOString();
    if (rows.length) rows.push({ ...rows[rows.length - 1]!, at: now, label: "Now" });
    return { rows, bookKeys };
  }, [history.data]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label={`Line history for ${selection.label}`} onClick={onClose}>
      <div className="h-full w-full max-w-[720px] overflow-y-auto border-l border-line bg-canvas p-4 sm:p-6" onClick={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-[10px] font-bold tracking-[0.17em] text-lime">LINE MOVEMENT</p>
            <h3 className="font-display text-lg font-bold">{selection.label}</h3>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">{selection.marketLabel}<SignalBadges signals={selection.signals} /></p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border border-line p-2 text-muted hover:text-white"><X size={15} /></button>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Tile label="Best price" value={live.best ? `${american(live.best.american)} ${bookShort(live.best.book)}` : "—"} />
          <Tile label="Worst price" value={live.worst ? `${american(live.worst.american)} ${bookShort(live.worst.book)}` : "—"} />
          <Tile label="Market average" value={american(live.average?.american)} />
          <Tile label="Fair (no-vig)" value={american(live.fair?.american)} sub={live.fair?.sourceLabel} />
          <Tile label="Fair probability" value={live.fair ? pct(live.fair.probability) : "—"} />
        </div>
        <Panel title="Odds history" subtitle={view === "books" ? "Implied probability by sportsbook (higher = shorter price)" : "Best and worst available price, market average and fair value over time"}
          action={<Segmented label="Chart" value={view} onChange={setView} options={[{ value: "books", label: "By sportsbook" }, { value: "range", label: "Best vs worst" }]} />}>
          {history.isLoading ? <LoadingBlock label="Loading odds history…" /> : view === "range" ? (range.length < 2 ? (
            <EmptyState>The price range is recorded every time the best price, worst price or fair value changes.</EmptyState>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={range} margin={{ top: 10, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="label" {...axis} dy={8} minTickGap={28} />
                  <YAxis {...axis} domain={["auto", "auto"]} tickFormatter={(value: number) => `${value}%`} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#a9b5b4" }}
                    formatter={(value: number, name: string, item: { payload?: { bestLabel?: string; worstLabel?: string } }) => [
                      name === "best" ? `${value}% · ${item.payload?.bestLabel ?? ""}` : name === "worst" ? `${value}% · ${item.payload?.worstLabel ?? ""}` : `${value}%`,
                      RANGE_LABELS[name] ?? name,
                    ]} />
                  <Legend formatter={(value: string) => <span className="text-[10px] text-muted">{RANGE_LABELS[value] ?? value}</span>} />
                  <Line dataKey="best" type="stepAfter" stroke="#c5f467" strokeWidth={2} dot={false} connectNulls />
                  <Line dataKey="worst" type="stepAfter" stroke="#fb7185" strokeWidth={2} dot={false} connectNulls />
                  <Line dataKey="average" type="stepAfter" stroke="#849198" strokeWidth={1.5} dot={false} connectNulls />
                  <Line dataKey="fair" type="stepAfter" stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )) : chart.rows.length < 2 ? (
            <EmptyState>History starts when SharpStats first sees a price. Changes are recorded on every refresh.</EmptyState>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart.rows} margin={{ top: 10, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="label" {...axis} dy={8} minTickGap={28} />
                  <YAxis {...axis} domain={["auto", "auto"]} tickFormatter={(value: number) => `${value}%`} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#a9b5b4" }} formatter={(value: number, name: string) => [`${value}%`, books.find((book) => book.key === name)?.name ?? name]} />
                  <Legend formatter={(value: string) => <span className="text-[10px] text-muted">{bookShort(value)}</span>} />
                  {chart.bookKeys.map((book, index) => <Line key={book} dataKey={book} type="stepAfter" stroke={COLORS[index % COLORS.length]} strokeWidth={2} dot={false} connectNulls />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
        <div className="mt-4">
          <Panel title="Price movement by sportsbook" flush>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left">
                <thead><tr className={thClass}><th className="px-4 py-3">BOOK</th><th className="px-3 py-3 text-right">OPEN</th><th className="px-3 py-3 text-right">CURRENT</th><th className="px-3 py-3 text-right">PEAK</th><th className="px-3 py-3 text-right">LOWEST</th><th className="px-3 py-3 text-right">MOVE</th><th className="px-4 py-3 text-right">CHANGED</th></tr></thead>
                <tbody>
                  {live.books.map((price) => (
                    <tr key={price.book} className="border-t border-line text-xs">
                      <td className="px-4 py-2.5"><BookTag book={price.book} books={books} /></td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{price.open ? `${price.open.point !== null ? `${priceLine(selection, { point: price.open.point })} ` : ""}${american(price.open.american)}` : "—"}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${price.isBest ? "text-lime" : "text-white"}`}>{priceLine(selection, price)} {american(price.american)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{american(price.high)}{price.highPoint !== null && price.lowPoint !== null && price.highPoint !== price.lowPoint ? <span className="ml-1 text-[10px] text-muted">({price.lowPoint}–{price.highPoint})</span> : null}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{american(price.low)}</td>
                      <td className="px-3 py-2.5 text-right"><span className="flex flex-col items-end"><span className="text-[10px] text-muted">{lineMoveText(selection, price)}</span><MoveIndicator value={price.probabilityMove} points={price.pointMove} /></span></td>
                      <td className="px-4 py-2.5 text-right text-muted">{price.lastChangeAt ? timeAgo(price.lastChangeAt) : "Unchanged"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
        <p className="mt-3 text-[10px] text-muted">Opening prices are the provider's opener where published (DraftKings via ESPN), otherwise the first price SharpStats recorded.</p>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-[#0e1416] p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 font-display text-base font-bold text-white">{value}</p>
      {sub && <p className="mt-0.5 truncate text-[10px] text-muted" title={sub}>{sub}</p>}
    </div>
  );
}

/** Movement tab: biggest movers since open, steam and sharp flags, and the live movement feed. */
export function MovementView({ data, books, onOpen, loading }: { data: MovementData | undefined; books: BookInfo[]; onOpen: (selectionId: string) => void; loading: boolean }) {
  if (loading && !data) return <LoadingBlock label="Loading line movement…" />;
  if (!data) return <Panel><EmptyState>Line movement is unavailable right now.</EmptyState></Panel>;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Steam moves" subtitle="3+ books moving the same side within 10 minutes" className="xl:col-span-1">
          <SignalList rows={data.steam} icon={<Flame size={13} className="text-orange-300" />} empty="No steam moves in the current window." onOpen={onOpen} />
        </Panel>
        <Panel title="Sharp money tracker" subtitle={data.sharpReference ? `Moves led by ${books.find((book) => book.key === data.sharpReference)?.name ?? data.sharpReference}, the sharp reference market` : "Needs a sharp reference book (The Odds API key)"}>
          <SignalList rows={data.sharp} icon={<Zap size={13} className="text-violet-300" />} empty={data.sharpReference ? "No sharp-led moves in the current window." : "Sharp tracking compares soft books against Pinnacle, which requires ODDS_API_KEY."} onOpen={onOpen} />
        </Panel>
        <Panel title="Reverse line movement" subtitle="Estimated: lines moving toward the underdog or under since open">
          <SignalList rows={data.reverse} icon={<Repeat size={13} className="text-sky-300" />} empty="No reverse line movement since the opening numbers." onOpen={onOpen} />
          <p className="mt-3 text-[10px] leading-relaxed text-muted">The odds providers don't publish public ticket or handle percentages, so SharpStats treats the favorite and the over as the public side, which is where recreational money usually goes. A move of 2.5%+ implied (about a point) toward the other side, backed by most books, is flagged. Big moves can also come from injury or lineup news, so check the news before acting on one.</p>
        </Panel>
      </div>
      <Panel title="Biggest movers since open" subtitle="Average implied-probability change across books" flush>
        {!data.movers.length ? <EmptyState>No significant moves since the opening numbers.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead><tr className={thClass}><th className="px-4 py-3">SELECTION</th><th className="px-3 py-3">GAME</th><th className="px-3 py-3 text-right">MOVE</th><th className="px-3 py-3 text-right">POINTS</th><th className="px-4 py-3 text-right">BEST NOW</th></tr></thead>
              <tbody>
                {data.movers.map((row) => (
                  <tr key={row.selectionId} className="border-t border-line text-xs">
                    <td className="px-4 py-2.5"><button type="button" onClick={() => onOpen(row.selectionId)} className="text-left font-medium text-white hover:text-lime">{row.label}</button><span className="ml-2 text-[10px] text-muted">{row.marketLabel}</span> <SignalBadges signals={row.signals} /></td>
                    <td className="px-3 py-2.5 text-muted">{row.game}</td>
                    <td className="px-3 py-2.5 text-right"><MoveIndicator value={row.probabilityMove} /></td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{row.pointMove ? `${row.pointMove > 0 ? "+" : ""}${Math.round(row.pointMove * 10) / 10}` : "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-lime">{row.best ? `${american(row.best.american)} ${bookShort(row.best.book)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Live movement feed" subtitle="Every price change recorded in the last 24 hours" flush>
        {!data.movements.length ? <EmptyState>No price changes recorded yet. Moves appear here as soon as a book changes a number.</EmptyState> : (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="sticky top-0 bg-panel"><tr className={thClass}><th className="px-4 py-3">TIME</th><th className="px-3 py-3">SELECTION</th><th className="px-3 py-3">BOOK</th><th className="px-3 py-3 text-right">FROM</th><th className="px-3 py-3 text-right">TO</th><th className="px-4 py-3 text-right">IMPLIED Δ</th></tr></thead>
              <tbody>
                {data.movements.map((move, index) => (
                  <tr key={`${move.sideId}-${move.book}-${move.movedAt}-${index}`} className="border-t border-line text-xs">
                    <td className="whitespace-nowrap px-4 py-2 text-muted">{timeAgo(move.movedAt)}</td>
                    <td className="px-3 py-2"><button type="button" onClick={() => onOpen(move.sideId)} className="text-left text-white hover:text-lime">{move.label}</button><span className="block text-[10px] text-muted">{move.game}</span></td>
                    <td className="px-3 py-2"><BookTag book={move.book} books={books} compact /></td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#d9e0dc]">{move.fromPoint !== null ? `${move.fromPoint} ` : ""}{american(move.fromAmerican)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-white">{move.toPoint !== null ? `${move.toPoint} ` : ""}{american(move.toAmerican)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${move.direction > 0 ? "text-lime" : "text-rose-400"}`}>{signedPct(move.probabilityDelta)}</td>
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

function SignalList({ rows, icon, empty, onOpen }: { rows: MovementData["steam"]; icon: ReactNode; empty: string; onOpen: (id: string) => void }) {
  if (!rows.length) return <p className="py-4 text-xs text-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.slice(0, 12).map((row) => (
        <li key={row.selectionId}>
          <button type="button" onClick={() => onOpen(row.selectionId)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-[#0e1416] px-3 py-2 text-left hover:border-[#34412a]">
            <span className="min-w-0"><span className="flex items-center gap-1.5 truncate text-xs text-white">{icon}{row.label}</span><span className="block truncate text-[10px] text-muted">{row.marketLabel} · {row.game}</span></span>
            <span className="shrink-0 text-xs font-semibold text-lime">{row.best ? american(row.best.american) : "—"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
