import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Flame, Minus, Zap } from "lucide-react";
import type { BookInfo, EvTier, RiskRating, SideSignals } from "../../lib/oddsTypes";
import { bookShort, pct, TIER_LABELS } from "../../lib/oddsFormat";

export function bookName(books: BookInfo[] | undefined, key: string): string {
  return books?.find((book) => book.key === key)?.name ?? key;
}

export function BookTag({ book, books, compact = false }: { book: string; books?: BookInfo[]; compact?: boolean }) {
  const info = books?.find((item) => item.key === book);
  return (
    <span title={info?.name ?? book} className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${info?.kind === "dfs" ? "bg-sky-400/10 text-sky-300" : info?.kind === "reference" ? "bg-amber-400/10 text-amber-300" : "bg-[#1b2428] text-[#c9d2cf]"}`}>{bookShort(book)}</span>
      {!compact && <span className="text-[#d9e0dc]">{info?.name ?? book}</span>}
    </span>
  );
}

/** Direction of a market move from this side's perspective (positive = the market likes the side more). */
export function MoveIndicator({ value, points }: { value: number | null; points?: number | null }) {
  if (value === null || Math.abs(value) < 0.0025) {
    if (points) return <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-300">{points > 0 ? "+" : ""}{points} pts</span>;
    return <Minus size={11} className="text-[#4d595e]" aria-label="No movement" />;
  }
  const up = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${up ? "text-lime" : "text-rose-400"}`} title={`${up ? "Market moved toward" : "Market moved away from"} this side by ${pct(Math.abs(value))} implied`}>
      {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}{pct(Math.abs(value))}
    </span>
  );
}

export function SignalBadges({ signals }: { signals: SideSignals }) {
  if (!signals.steam && !signals.sharp) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {signals.steam && <span title="Steam move: several books moved this side within minutes" className="inline-flex items-center gap-0.5 rounded-md bg-orange-400/10 px-1.5 py-0.5 text-[9px] font-bold text-orange-300"><Flame size={10} />STEAM</span>}
      {signals.sharp && <span title="Sharp action: the sharp reference market moved this side" className="inline-flex items-center gap-0.5 rounded-md bg-violet-400/10 px-1.5 py-0.5 text-[9px] font-bold text-violet-300"><Zap size={10} />SHARP</span>}
    </span>
  );
}

const TIER_STYLE: Record<EvTier, string> = {
  positive: "bg-lime/10 text-lime",
  strong: "bg-emerald-400/15 text-emerald-300",
  elite: "bg-lime text-[#11170c]",
};

export function TierBadge({ tier }: { tier: EvTier | null }) {
  if (!tier) return null;
  return <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${TIER_STYLE[tier]}`}>{TIER_LABELS[tier]}</span>;
}

export function RiskBadge({ risk }: { risk: RiskRating | null }) {
  if (!risk) return <span className="text-muted">—</span>;
  const style = risk === "low" ? "text-lime" : risk === "medium" ? "text-amber-300" : "text-rose-400";
  return <span className={`text-[10px] font-semibold uppercase ${style}`}>{risk}</span>;
}

export function LiveDot({ live }: { live: boolean }) {
  if (!live) return null;
  return <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold text-rose-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />LIVE</span>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }) {
  const style = tone === "error" ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : tone === "warn" ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-line bg-[#0e1416] text-muted";
  return <div className={`rounded-xl border px-4 py-3 text-xs leading-relaxed ${style}`}>{children}</div>;
}

export const tdClass = "px-3 py-3 align-middle";
export const numClass = "px-3 py-3 text-right align-middle tabular-nums";
