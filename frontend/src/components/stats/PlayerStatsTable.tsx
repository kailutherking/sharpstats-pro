import { useEffect, useMemo, useState } from "react";
import type { PlayerGroup, PlayerRow } from "../../lib/statsTypes";
import { formatStat } from "../../lib/statsFormat";
import { Avatar, CompareToggle, EmptyState, FavoriteButton, SortHeader, thClass } from "./StatsUi";

const PAGE_SIZE = 25;

export function sortPlayers(players: PlayerRow[], key: string, direction: "asc" | "desc"): PlayerRow[] {
  return [...players].sort((a, b) => {
    if (key === "name") return direction === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    const left = a.values[key];
    const right = b.values[key];
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    return direction === "asc" ? left - right : right - left;
  });
}

export function PlayerStatsTable({ group, players, favorites, onFavorite, compare, onCompare, onPlayer, showSample, onSorted }: {
  group: PlayerGroup;
  players: PlayerRow[];
  favorites: Set<string>;
  onFavorite: (player: PlayerRow) => void;
  compare: string[];
  onCompare: (id: string) => void;
  onPlayer: (id: string) => void;
  showSample: boolean;
  onSorted?: (rows: PlayerRow[]) => void;
}) {
  const primary = group.columns.find((column) => column.key === group.primary);
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: group.primary, direction: primary?.direction ?? "desc" });
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => { setSort({ key: group.primary, direction: primary?.direction ?? "desc" }); setLimit(PAGE_SIZE); }, [group.key, group.primary, primary?.direction]);
  const rows = useMemo(() => sortPlayers(players, sort.key, sort.direction), [players, sort]);
  useEffect(() => { onSorted?.(rows); }, [rows, onSorted]);
  const toggleSort = (key: string, preferred: "asc" | "desc") => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: preferred });

  if (!players.length) return <EmptyState>No players match the current search and filters.</EmptyState>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left">
          <thead>
            <tr className={thClass}>
              <th className="w-16 px-4 py-3"><span className="sr-only">Favorite and compare</span></th>
              <SortHeader label="PLAYER" active={sort.key === "name"} direction={sort.direction} onClick={() => toggleSort("name", "asc")} align="left" />
              {showSample && <th className="px-3 py-3 text-right">SAMPLE</th>}
              {group.columns.map((column) => (
                <SortHeader key={column.key} label={column.short} title={column.label} active={sort.key === column.key} direction={sort.direction} onClick={() => toggleSort(column.key, column.direction)} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((player, index) => (
              <tr key={player.id} onClick={() => onPlayer(player.id)} className="cursor-pointer border-t border-line text-xs transition hover:bg-white/[0.02]">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1">
                    <FavoriteButton active={favorites.has(player.id)} onToggle={() => onFavorite(player)} label={player.name} />
                    <CompareToggle active={compare.includes(player.id)} onToggle={() => onCompare(player.id)} label={player.name} />
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="w-5 text-[10px] text-muted">{index + 1}</span>
                    <Avatar src={player.headshot} name={player.name} size={28} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{player.name}</p>
                      <p className="mt-0.5 text-[10px] text-muted">{player.teamAbbr || "FA"} · {player.position}{player.status && player.status !== "Active" ? ` · ${player.status}` : ""}</p>
                    </div>
                  </div>
                </td>
                {showSample && <td className="px-3 py-2.5 text-right text-muted">{player.sample ?? "—"} G</td>}
                {group.columns.map((column) => (
                  <td key={column.key} className={`px-3 py-2.5 text-right tabular-nums ${sort.key === column.key ? "font-semibold text-lime" : "text-[#d9e0dc]"}`}>
                    {formatStat(player.values[column.key], column.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-[11px] text-muted">
        <span>Showing {Math.min(limit, rows.length)} of {rows.length} players</span>
        {limit < rows.length && <button type="button" onClick={() => setLimit(limit + PAGE_SIZE * 2)} className="font-semibold text-lime">Show more</button>}
      </div>
    </>
  );
}
