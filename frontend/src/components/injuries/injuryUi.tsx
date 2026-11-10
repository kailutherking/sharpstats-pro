import type { ImpactLevel, ImpactTier, InjuryStatus } from "../../lib/injuryTypes";

const STATUS_STYLE: Record<InjuryStatus, string> = {
  Out: "bg-rose-500/15 text-rose-300",
  "Injured Reserve": "bg-rose-500/15 text-rose-300",
  Inactive: "bg-rose-500/15 text-rose-300",
  Suspended: "bg-violet-400/15 text-violet-300",
  Doubtful: "bg-orange-400/15 text-orange-300",
  Questionable: "bg-amber-400/15 text-amber-300",
  "Game Time Decision": "bg-amber-400/15 text-amber-300",
  "Day-to-Day": "bg-sky-400/10 text-sky-300",
  Probable: "bg-lime/10 text-lime",
  Active: "bg-lime/10 text-lime",
};

export function StatusPill({ status }: { status: InjuryStatus }) {
  return <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold ${STATUS_STYLE[status]}`}>{status === "Active" ? "Returning" : status}</span>;
}

const TIER_STYLE: Record<ImpactTier, string> = {
  Elite: "bg-lime text-[#11170c]", High: "bg-lime/15 text-lime", Moderate: "bg-amber-400/10 text-amber-300", Low: "bg-[#1b2428] text-[#c9d2cf]", Minimal: "bg-[#1b2428] text-muted",
};

export function TierBadge({ tier, score }: { tier: ImpactTier; score?: number }) {
  return <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${TIER_STYLE[tier]}`} title={score !== undefined ? `Importance ${score}/100` : undefined}>{tier}{score !== undefined ? ` · ${score}` : ""}</span>;
}

export const LEVEL_TONE: Record<ImpactLevel, string> = { "Very High": "text-lime", High: "text-lime", Moderate: "text-amber-300", Low: "text-[#c9d2cf]", None: "text-muted" };

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function updatedAgo(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return shortDate(iso);
}

export const signed = (value: number) => (value > 0 ? `+${value}` : String(value));
