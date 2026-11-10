import type { TeamHealth } from "../../lib/injuryTypes";
import { Avatar, EmptyState } from "../stats/StatsUi";

const tone = (score: number) => (score >= 85 ? "bg-lime" : score >= 70 ? "bg-lime/60" : score >= 50 ? "bg-amber-300" : "bg-rose-400");
const text = (score: number) => (score >= 85 ? "text-lime" : score >= 70 ? "text-lime/80" : score >= 50 ? "text-amber-300" : "text-rose-400");

/** Team health cards: health score, active/questionable/returning/suspended counts and key absences. */
export function TeamHealthDashboard({ teams, selected, onSelect }: { teams: TeamHealth[]; selected: string; onSelect: (teamId: string) => void }) {
  if (!teams.length) return <EmptyState>No team injury reports.</EmptyState>;
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {teams.map((team) => (
        <button key={team.teamId} type="button" onClick={() => onSelect(selected === team.teamId ? "" : team.teamId)} aria-pressed={selected === team.teamId}
          className={`rounded-xl border bg-[#0e1416] p-3 text-left transition hover:border-[#536048] ${selected === team.teamId ? "border-lime" : "border-line"}`}>
          <div className="flex items-center gap-2.5">
            <Avatar src={team.logo} name={team.teamAbbr} size={28} square />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">{team.teamName}</p>
              <p className={`text-[10px] font-semibold ${text(team.score)}`}>{team.label}</p>
            </div>
            <span className={`font-display text-xl font-extrabold tabular-nums ${text(team.score)}`}>{team.score}</span>
          </div>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[#1b2428]"><div className={`h-full ${tone(team.score)}`} style={{ width: `${team.score}%` }} /></div>
          <div className="mt-2.5 grid grid-cols-4 gap-1 text-center">
            {[["Injured", team.active], ["Doubt/Q", team.questionable], ["Return", team.returning], ["Susp.", team.suspended]].map(([label, value]) => (
              <div key={label}><p className="text-sm font-bold tabular-nums text-white">{value}</p><p className="text-[9px] text-[#69757a]">{label}</p></div>
            ))}
          </div>
          {team.keyOut.length > 0 && <p className="mt-2 truncate text-[10px] text-muted">Key absences: <span className="text-[#d9e0dc]">{team.keyOut.join(", ")}</span></p>}
        </button>
      ))}
    </div>
  );
}
