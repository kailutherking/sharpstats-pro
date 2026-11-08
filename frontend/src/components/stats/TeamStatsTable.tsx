import { useEffect, useMemo, useState } from "react";
import type { ColumnMeta, TeamRow } from "../../lib/statsTypes";
import { formatStat } from "../../lib/statsFormat";
import { Avatar, CompareToggle, EmptyState, FavoriteButton, SortHeader, thClass } from "./StatsUi";

type SortKey = "name" | "winPct" | "offRank" | "defRank" | string;

function sortValue(team: TeamRow, key: SortKey): number | string | null {
  if (key === "name") return team.name;
  if (key === "winPct") return team.winPct;
  if (key === "offRank") return team.offRank;
  if (key === "defRank") return team.defRank;
  return team.values[key] ?? null;
}

export function sortTeams(teams: TeamRow[], key: SortKey, direction: "asc" | "desc"): TeamRow[] {
  return [...teams].sort((a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    if (left === null) return 1;
    if (right === null) return -1;
    if (typeof left === "string" || typeof right === "string") return direction === "asc" ? String(left).localeCompare(String(right)) : String(right).localeCompare(String(left));
    return direction === "asc" ? left - right : right - left;
  });
}

export function TeamStatsTable({ teams, columns, favorites, onFavorite, compare, onCompare, onTeam, onSorted }: {
  teams: TeamRow[];
  columns: ColumnMeta[];
  favorites: Set<string>;
  onFavorite: (team: TeamRow) => void;
  compare: string[];
  onCompare: (id: string) => void;
  onTeam: (id: string) => void;
  onSorted?: (rows: TeamRow[]) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "winPct", direction: "desc" });
  const rows = useMemo(() => sortTeams(teams, sort.key, sort.direction), [teams, sort]);
  useEffect(() => { onSorted?.(rows); }, [rows, onSorted]);
  const toggle = (key: SortKey, preferred: "asc" | "desc") => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: preferred });
  if (!teams.length) return <EmptyState>No teams match the current search and filters.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left">
        <thead>
          <tr className={thClass}>
            <th className="w-16 px-4 py-3"><span className="sr-only">Favorite and compare</span></th>
            <SortHeader label="TEAM" active={sort.key === "name"} direction={sort.direction} onClick={() => toggle("name", "asc")} align="left" />
            <th className="px-3 py-3 text-right">RECORD</th>
            <th className="px-3 py-3 text-right">HOME</th>
            <th className="px-3 py-3 text-right">AWAY</th>
            <SortHeader label="WIN%" title="Win percentage" active={sort.key === "winPct"} direction={sort.direction} onClick={() => toggle("winPct", "desc")} />
            {columns.map((column) => (
              <SortHeader key={column.key} label={column.short} title={column.label} active={sort.key === column.key} direction={sort.direction} onClick={() => toggle(column.key, column.direction)} />
            ))}
            <SortHeader label="OFF RK" title="Offensive ranking" active={sort.key === "offRank"} direction={sort.direction} onClick={() => toggle("offRank", "asc")} />
            <SortHeader label="DEF RK" title="Defensive ranking" active={sort.key === "defRank"} direction={sort.direction} onClick={() => toggle("defRank", "asc")} />
          </tr>
        </thead>
        <tbody>
          {rows.map((team) => (
            <tr key={team.id} onClick={() => onTeam(team.id)} className="cursor-pointer border-t border-line text-xs transition hover:bg-white/[0.02]">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-1">
                  <FavoriteButton active={favorites.has(team.id)} onToggle={() => onFavorite(team)} label={team.name} />
                  <CompareToggle active={compare.includes(team.id)} onToggle={() => onCompare(team.id)} label={team.name} />
                </div>
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <Avatar src={team.logo} name={team.name} size={26} square />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{team.name}</p>
                    <p className="mt-0.5 text-[10px] text-muted">{team.division || team.conference}{team.streak ? ` · ${team.streak}` : ""}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5 text-right font-semibold text-white">{team.record}</td>
              <td className="px-3 py-2.5 text-right text-[#d9e0dc]">{team.home || "—"}</td>
              <td className="px-3 py-2.5 text-right text-[#d9e0dc]">{team.away || "—"}</td>
              <td className={`px-3 py-2.5 text-right tabular-nums ${sort.key === "winPct" ? "font-semibold text-lime" : "text-[#d9e0dc]"}`}>{formatStat(team.winPct, "rate3")}</td>
              {columns.map((column) => (
                <td key={column.key} className={`px-3 py-2.5 text-right tabular-nums ${sort.key === column.key ? "font-semibold text-lime" : "text-[#d9e0dc]"}`}>{formatStat(team.values[column.key], column.format)}</td>
              ))}
              <td className="px-3 py-2.5 text-right"><RankBadge rank={team.offRank} total={teams.length} /></td>
              <td className="px-3 py-2.5 text-right"><RankBadge rank={team.defRank} total={teams.length} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RankBadge({ rank, total }: { rank: number | null; total: number }) {
  if (rank === null) return <span className="text-muted">—</span>;
  const tier = rank <= Math.ceil(total / 3) ? "bg-lime/10 text-lime" : rank > Math.floor(total * 2 / 3) ? "bg-rose-400/10 text-rose-400" : "bg-[#20292e] text-[#d9e0dc]";
  return <span className={`inline-block min-w-[30px] rounded-md px-1.5 py-0.5 text-center text-[10px] font-semibold ${tier}`}>{rank}</span>;
}
