import type { ReactNode } from "react";
import { Activity, BookOpen, Clock3, Compass, Gauge, Layers, Scale, Zap } from "lucide-react";
import type { BoardMetrics, BookInfo } from "../../lib/oddsTypes";
import { american, pct } from "../../lib/oddsFormat";
import { formatUpdated } from "../../lib/statsFormat";
import { bookName } from "./OddsUi";

function Metric({ icon, label, value, note, tone = "lime", onClick }: { icon: ReactNode; label: string; value: string; note: string; tone?: "lime" | "blue" | "amber" | "violet"; onClick?: () => void }) {
  const color = tone === "lime" ? "text-lime bg-lime/10" : tone === "blue" ? "text-sky-300 bg-sky-400/10" : tone === "amber" ? "text-amber-300 bg-amber-400/10" : "text-violet-300 bg-violet-400/10";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={`flex min-w-0 items-start gap-3 rounded-xl border border-line bg-panel p-4 text-left ${onClick ? "transition hover:border-[#34412a]" : ""}`}>
      <div className={`shrink-0 rounded-lg p-2 ${color}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted">{label}</p>
        <p className="mt-1 truncate font-display text-lg font-bold text-white">{value}</p>
        <p className="mt-0.5 truncate text-[10px] text-muted" title={note}>{note}</p>
      </div>
    </Tag>
  );
}

export function OddsDashboard({ metrics, books, onOpen }: { metrics: BoardMetrics; books: BookInfo[]; onOpen: (tab: "board" | "ev" | "arbitrage" | "movement" | "shop") => void }) {
  const best = metrics.bestAvailable;
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
      <Metric
        icon={<Compass size={16} />} tone="blue" label="Best available odds"
        value={best ? `${american(best.american)} ${bookName(books, best.book)}` : "—"}
        note={best ? `${best.label} · ${best.edge > 0 ? `${pct(best.edge)} better than market avg` : best.market}` : "No priced markets yet"}
        onClick={() => onOpen("shop")}
      />
      <Metric
        icon={<Zap size={16} />} label="Positive EV opportunities" value={String(metrics.positiveEv)}
        note={`${metrics.evTiers.elite} elite · ${metrics.evTiers.strong} strong · ${metrics.evTiers.positive} positive`}
        onClick={() => onOpen("ev")}
      />
      <Metric icon={<Scale size={16} />} tone="amber" label="Arbitrage opportunities" value={String(metrics.arbitrage)} note="Guaranteed-return price combinations" onClick={() => onOpen("arbitrage")} />
      <Metric icon={<BookOpen size={16} />} tone="violet" label="Sportsbooks connected" value={`${metrics.booksConnected} / ${metrics.booksTotal}`} note="Books with prices in this league" onClick={() => onOpen("shop")} />
      <Metric icon={<Layers size={16} />} label="Markets tracked" value={metrics.marketsTracked.toLocaleString()} note={`${metrics.selectionsTracked.toLocaleString()} selections`} onClick={() => onOpen("board")} />
      <Metric icon={<Gauge size={16} />} tone="blue" label="Games tracked" value={String(metrics.gamesTracked)} note={metrics.liveGames ? `${metrics.liveGames} live now` : "No games in progress"} />
      <Metric icon={<Activity size={16} />} tone="amber" label="Live line movements" value={String(metrics.lineMovements)} note={`Past hour · ${metrics.steamMoves} steam move${metrics.steamMoves === 1 ? "" : "s"} active`} onClick={() => onOpen("movement")} />
      <Metric icon={<Clock3 size={16} />} tone="violet" label="Last update" value={metrics.lastUpdate ? new Date(metrics.lastUpdate).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—"} note={formatUpdated(metrics.lastUpdate ?? undefined)} />
    </div>
  );
}
