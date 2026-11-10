import type { InjuryRow } from "../../lib/injuryTypes";
import { Avatar, EmptyState, thClass } from "../stats/StatsUi";
import { shortDate, StatusPill, TierBadge, updatedAgo } from "./injuryUi";

/** Player, team, position, injury, status, expected return, last updated, source and impact. */
export function InjuryTable({ rows, onPlayer }: { rows: InjuryRow[]; onPlayer: (row: InjuryRow) => void }) {
  if (!rows.length) return <EmptyState>No injuries match these filters.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] text-xs">
        <thead>
          <tr className={`${thClass} border-b border-line text-left`}>
            <th className="px-4 py-3">PLAYER</th><th className="px-3 py-3">TEAM</th><th className="px-3 py-3">POS</th><th className="px-3 py-3">INJURY</th><th className="px-3 py-3">STATUS</th>
            <th className="px-3 py-3">EXPECTED RETURN</th><th className="px-3 py-3">IMPACT</th><th className="px-3 py-3">LAST UPDATED</th><th className="px-3 py-3">SOURCE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.teamId}-${row.athleteId}`} onClick={() => onPlayer(row)} className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-white/[0.02]">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <Avatar src={row.headshot} name={row.name} size={30} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">{row.name}</p>
                    <p className="max-w-[260px] truncate text-[10px] text-muted" title={row.shortComment}>{row.shortComment}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5"><span className="flex items-center gap-1.5"><Avatar src={row.teamLogo} name={row.teamAbbr} size={18} square /><span className="text-[#d9e0dc]">{row.teamAbbr}</span></span></td>
              <td className="px-3 py-2.5 text-[#d9e0dc]">{row.position || "—"}</td>
              <td className="px-3 py-2.5 text-[#d9e0dc]">{row.injury}</td>
              <td className="px-3 py-2.5"><StatusPill status={row.status} /></td>
              <td className="px-3 py-2.5 tabular-nums text-[#d9e0dc]">{row.returnDate ? shortDate(row.returnDate) : row.status === "Active" ? "Cleared" : "TBD"}</td>
              <td className="px-3 py-2.5"><TierBadge tier={row.impact.tier} score={row.impact.importance} /></td>
              <td className="px-3 py-2.5 text-muted" title={new Date(row.reportedAt).toLocaleString()}>{updatedAgo(row.reportedAt)}</td>
              <td className="px-3 py-2.5 text-muted">{row.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
