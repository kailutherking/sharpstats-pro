import type { ReactNode } from "react";
import { Calendar, Crosshair, Crown, Flame, Layers, Medal, Send, ShoppingBag, Split, Target, Users } from "lucide-react";
import { Avatar } from "../stats/StatsUi";

export const BADGE_ICONS: Record<string, typeof Medal> = {
  send: Send, flame: Flame, crown: Crown, target: Target, crosshair: Crosshair, "shopping-bag": ShoppingBag, split: Split, layers: Layers, users: Users, calendar: Calendar,
};

export function BadgeIcon({ icon, size = 14 }: { icon: string; size?: number }) {
  const Icon = BADGE_ICONS[icon] ?? Medal;
  return <Icon size={size} />;
}

export function LevelPill({ level, rank }: { level: number; rank?: string }) {
  return <span className="whitespace-nowrap rounded-md bg-lime/10 px-1.5 py-0.5 text-[9px] font-bold text-lime" title={rank ? `${rank} · level ${level}` : `Level ${level}`}>LV {level}{rank ? ` · ${rank.toUpperCase()}` : ""}</span>;
}

export function UserChip({ name, handle, avatarUrl, onOpen, sub, size = 30 }: { name: string; handle: string; avatarUrl: string | null; onOpen?: (handle: string) => void; sub?: ReactNode; size?: number }) {
  return (
    <button type="button" onClick={() => onOpen?.(handle)} disabled={!onOpen} className="flex min-w-0 items-center gap-2 text-left disabled:cursor-default">
      <Avatar src={avatarUrl} name={name} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-white hover:text-lime">{name}</span>
        <span className="block truncate text-[10px] text-muted">@{handle}{sub ? <> · {sub}</> : null}</span>
      </span>
    </button>
  );
}

export const units = (value: number | null | undefined, digits = 2) => (value === null || value === undefined ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}u`);
export const ratio = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`);

export function ago(iso: string): string {
  const seconds = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Simple XP progress bar toward the next level. */
export function XpBar({ current, next, level }: { current: number; next: number; level: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] text-muted"><span>Level {level}</span><span className="tabular-nums">{current} / {next} XP</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#1b2428]"><div className="h-full rounded-full bg-lime" style={{ width: `${Math.min(100, (current / Math.max(1, next)) * 100)}%` }} /></div>
    </div>
  );
}
