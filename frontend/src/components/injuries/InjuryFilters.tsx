import { Search } from "lucide-react";
import type { InjuryStatus } from "../../lib/injuryTypes";
import type { League } from "../../lib/statsTypes";
import { LeagueSelector } from "../stats/LeagueSelector";
import { inputClass } from "../stats/StatsUi";

export interface InjuryFilterState { team: string; position: string; statuses: InjuryStatus[]; updated: "24h" | "3d" | "7d" | "all"; q: string }
export const EMPTY_INJURY_FILTERS: InjuryFilterState = { team: "", position: "", statuses: [], updated: "all", q: "" };

/** League, team, position, status, date-updated and search filters for the injury report. */
export function InjuryFilters({ league, onLeague, value, onChange, teams, positions, statuses, counts }: {
  league: League;
  onLeague: (league: League) => void;
  value: InjuryFilterState;
  onChange: (value: InjuryFilterState) => void;
  teams: Array<{ id: string; name: string }>;
  positions: string[];
  statuses: InjuryStatus[];
  counts: Partial<Record<InjuryStatus, number>>;
}) {
  const toggle = (status: InjuryStatus) => onChange({ ...value, statuses: value.statuses.includes(status) ? value.statuses.filter((item) => item !== status) : [...value.statuses, status] });
  const active = value.team || value.position || value.statuses.length || value.updated !== "all" || value.q;
  return (
    <div className="mb-4 space-y-3 rounded-2xl border border-line bg-panel p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <LeagueSelector value={league} onChange={onLeague} />
        <label className="relative block sm:w-72">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={value.q} onChange={(event) => onChange({ ...value, q: event.target.value })} placeholder="Search player, team or injury" aria-label="Search injuries" className={`${inputClass} w-full py-2.5 pl-9`} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <select aria-label="Team" value={value.team} onChange={(event) => onChange({ ...value, team: event.target.value })} className={inputClass}>
          <option value="">All teams</option>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
        <select aria-label="Position" value={value.position} onChange={(event) => onChange({ ...value, position: event.target.value })} className={inputClass}>
          <option value="">All positions</option>
          {positions.map((position) => <option key={position} value={position}>{position}</option>)}
        </select>
        <select aria-label="Date updated" value={value.updated} onChange={(event) => onChange({ ...value, updated: event.target.value as InjuryFilterState["updated"] })} className={inputClass}>
          <option value="all">Any update date</option>
          <option value="24h">Updated in 24 hours</option>
          <option value="3d">Updated in 3 days</option>
          <option value="7d">Updated in 7 days</option>
        </select>
        {active ? <button type="button" onClick={() => onChange(EMPTY_INJURY_FILTERS)} className="text-[11px] text-lime">Clear filters</button> : null}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Injury status">
        {statuses.map((status) => (
          <button key={status} type="button" aria-pressed={value.statuses.includes(status)} onClick={() => toggle(status)}
            className={`rounded-lg border px-2.5 py-1 text-[11px] ${value.statuses.includes(status) ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-white"}`}>
            {status === "Active" ? "Returning" : status} <span className="text-[#69757a]">{counts[status] ?? 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
