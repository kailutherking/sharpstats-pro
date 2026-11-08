import { Star } from "lucide-react";
import type { LeagueStats, StatsWindow } from "../../lib/statsTypes";
import { WINDOW_LABELS } from "../../lib/statsFormat";
import { inputClass } from "./StatsUi";

export interface StatsFilterState {
  window: StatsWindow;
  team: string;
  position: string;
  conference: string;
  division: string;
  favoritesOnly: boolean;
}

export const EMPTY_FILTERS: Omit<StatsFilterState, "window"> = { team: "", position: "", conference: "", division: "", favoritesOnly: false };

export function StatsFilters({ data, value, onChange, showPosition = true }: { data: LeagueStats | undefined; value: StatsFilterState; onChange: (next: StatsFilterState) => void; showPosition?: boolean }) {
  const set = <K extends keyof StatsFilterState>(key: K, next: StatsFilterState[K]) => onChange({ ...value, [key]: next });
  const divisions = (data?.filters.divisions ?? []).filter((division) => !value.conference || division.conference === value.conference);
  const teams = (data?.filters.teams ?? []).filter((team) => (!value.conference || team.conference === value.conference) && (!value.division || team.division === value.division));
  const active = value.team || value.position || value.conference || value.division || value.favoritesOnly;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Season window" value={value.window} onChange={(event) => set("window", event.target.value as StatsWindow)} className={inputClass}>
        {(Object.keys(WINDOW_LABELS) as StatsWindow[]).map((key) => <option key={key} value={key}>{WINDOW_LABELS[key]}</option>)}
      </select>
      <select aria-label={data?.conferenceLabel ?? "Conference"} value={value.conference} onChange={(event) => onChange({ ...value, conference: event.target.value, division: "", team: "" })} className={inputClass}>
        <option value="">All {(data?.conferenceLabel ?? "Conference").toLowerCase()}s</option>
        {(data?.filters.conferences ?? []).map((conference) => <option key={conference} value={conference}>{conference}</option>)}
      </select>
      <select aria-label="Division" value={value.division} onChange={(event) => onChange({ ...value, division: event.target.value, team: "" })} className={inputClass}>
        <option value="">All divisions</option>
        {divisions.map((division) => <option key={division.name} value={division.name}>{division.name}</option>)}
      </select>
      <select aria-label="Team" value={value.team} onChange={(event) => set("team", event.target.value)} className={`${inputClass} max-w-[180px]`}>
        <option value="">All teams</option>
        {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select>
      {showPosition && (
        <select aria-label="Position" value={value.position} onChange={(event) => set("position", event.target.value)} className={inputClass}>
          <option value="">All positions</option>
          {(data?.filters.positions ?? []).map((position) => <option key={position} value={position}>{position}</option>)}
        </select>
      )}
      <button
        type="button"
        aria-pressed={value.favoritesOnly}
        onClick={() => set("favoritesOnly", !value.favoritesOnly)}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs ${value.favoritesOnly ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-white"}`}
      >
        <Star size={13} className={value.favoritesOnly ? "fill-lime" : ""} />Favorites
      </button>
      {active && <button type="button" onClick={() => onChange({ ...value, ...EMPTY_FILTERS })} className="px-2 py-2 text-[11px] font-semibold text-lime">Clear filters</button>}
    </div>
  );
}
