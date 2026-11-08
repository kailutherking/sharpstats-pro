import type { League } from "../../lib/statsTypes";

export const LEAGUE_OPTIONS: Array<{ value: League; label: string; sport: string }> = [
  { value: "nba", label: "NBA", sport: "Basketball" },
  { value: "nfl", label: "NFL", sport: "Football" },
  { value: "mlb", label: "MLB", sport: "Baseball" },
  { value: "nhl", label: "NHL", sport: "Hockey" },
];

export function LeagueSelector({ value, onChange }: { value: League; onChange: (league: League) => void }) {
  return (
    <div role="tablist" aria-label="League" className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-[#0c1114] p-1 sm:inline-grid">
      {LEAGUE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-lg px-4 py-2 text-center transition sm:px-5 ${value === option.value ? "bg-[#202b24] text-lime" : "text-muted hover:bg-white/[0.04] hover:text-white"}`}
        >
          <span className="block font-display text-sm font-extrabold tracking-tight">{option.label}</span>
          <span className="hidden text-[9px] tracking-wider text-[#69757a] sm:block">{option.sport.toUpperCase()}</span>
        </button>
      ))}
    </div>
  );
}
