import type { League } from "../../lib/statsTypes";
import type { LiveGame, LiveStatus } from "../../lib/liveTypes";
import { inProgress } from "../../lib/liveTypes";

export const SPREAD_LABEL: Record<League, string> = { nba: "Spread", nfl: "Spread", mlb: "Run line", nhl: "Puck line", ncaab: "Spread" };

export function StatusBadge({ game }: { game: Pick<LiveGame, "status" | "statusLabel" | "clock" | "periodLabel" | "startTime"> }) {
  if (game.status === "pregame") {
    const start = new Date(game.startTime);
    return <span className="rounded-md bg-[#1b2428] px-2 py-0.5 text-[10px] font-semibold text-[#c9d2cf]">{start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>;
  }
  if (game.status === "final" || game.status === "postponed") return <span className="rounded-md bg-[#1b2428] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#c9d2cf]">{game.statusLabel}</span>;
  const breakTime = game.status === "halftime" || game.status === "end_period";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold ${breakTime ? "bg-amber-400/10 text-amber-300" : "bg-rose-500/15 text-rose-300"}`}>
        {!breakTime && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />}{breakTime ? game.statusLabel.toUpperCase() : "LIVE"}
      </span>
      {!breakTime && <span className="text-[11px] font-semibold tabular-nums text-white">{[game.periodLabel, game.clock].filter(Boolean).join(" · ")}</span>}
    </span>
  );
}

/** Home/away win probability bar. */
export function WinBar({ game }: { game: LiveGame }) {
  if (!game.winProbability) return null;
  const away = Math.round(game.winProbability.away * 100);
  const home = 100 - away;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] text-muted">
        <span><span className="font-semibold text-white">{away}%</span> {game.away.abbr}</span>
        <span className="text-[9px] uppercase tracking-wider">Win prob · {game.winProbability.source}</span>
        <span>{game.home.abbr} <span className="font-semibold text-white">{home}%</span></span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-[#1b2428]">
        <span className="h-full bg-sky-300/80" style={{ width: `${away}%` }} />
        <span className="h-full bg-lime" style={{ width: `${home}%` }} />
      </div>
    </div>
  );
}

/** Baseball diamond with occupied bases highlighted. */
export function Diamond({ first, second, third, size = 34 }: { first: boolean; second: boolean; third: boolean; size?: number }) {
  const base = (on: boolean) => (on ? "#c5f467" : "#20292e");
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-label={`Runners: ${[first && "1st", second && "2nd", third && "3rd"].filter(Boolean).join(", ") || "bases empty"}`}>
      <rect x="15" y="3" width="10" height="10" transform="rotate(45 20 8)" fill={base(second)} stroke="#3a464c" />
      <rect x="27" y="15" width="10" height="10" transform="rotate(45 32 20)" fill={base(first)} stroke="#3a464c" />
      <rect x="3" y="15" width="10" height="10" transform="rotate(45 8 20)" fill={base(third)} stroke="#3a464c" />
    </svg>
  );
}

export function CountDots({ label, value, max, tone = "lime" }: { label: string; value: number | null; max: number; tone?: "lime" | "rose" | "amber" }) {
  const color = tone === "rose" ? "bg-rose-400" : tone === "amber" ? "bg-amber-300" : "bg-lime";
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted" title={`${label}: ${value ?? "—"}`}>
      {label}
      {Array.from({ length: max }, (_, index) => <span key={index} className={`h-1.5 w-1.5 rounded-full ${value !== null && index < value ? color : "bg-[#27312a]"}`} />)}
    </span>
  );
}

export const isLive = (status: LiveStatus) => inProgress(status);
