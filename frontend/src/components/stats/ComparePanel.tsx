import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "../../lib/api";
import type { ColumnMeta, LeagueStats, PlayerRow, StatFormat, StatsWindow, TeamRow } from "../../lib/statsTypes";
import { formatStat } from "../../lib/statsFormat";
import { CompareBarChart, CompareTrendChart, SERIES_COLORS } from "./StatsCharts";
import { Avatar, EmptyState, inputClass, Panel, Segmented, thClass } from "./StatsUi";

export const MAX_COMPARE = 4;

interface Row { key: string; label: string; short: string; format: StatFormat; direction: "asc" | "desc"; values: Array<number | null> }

function best(row: Row): number | null {
  const values = row.values.filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  return row.direction === "asc" ? Math.min(...values) : Math.max(...values);
}

function CompareTable({ entities, rows }: { entities: Array<{ id: string; name: string; image: string | null; sub: string }>; rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left">
        <thead>
          <tr className={thClass}>
            <th className="px-5 py-3">STAT</th>
            {entities.map((entity, index) => (
              <th key={entity.id} className="px-3 py-3 text-right">
                <span className="inline-flex items-center justify-end gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />
                  <span className="max-w-[120px] truncate normal-case text-white">{entity.name}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const top = best(row);
            return (
              <tr key={row.key} className="border-t border-line text-xs">
                <td className="px-5 py-2.5"><span className="font-medium text-white">{row.short}</span><span className="ml-2 text-[10px] text-muted">{row.label}</span></td>
                {row.values.map((value, index) => (
                  <td key={entities[index]!.id} className={`px-3 py-2.5 text-right tabular-nums ${top !== null && value === top ? "font-semibold text-lime" : "text-[#d9e0dc]"}`}>{formatStat(value, row.format)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Chips({ entities, onRemove, onClear }: { entities: Array<{ id: string; name: string; image: string | null; sub: string }>; onRemove: (id: string) => void; onClear: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {entities.map((entity, index) => (
        <span key={entity.id} className="flex items-center gap-2 rounded-xl border border-line bg-[#0e1416] py-1.5 pl-1.5 pr-2 text-xs">
          <Avatar src={entity.image} name={entity.name} size={24} square={entity.sub === "team"} />
          <span className="h-2 w-2 rounded-full" style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />
          <span className="text-white">{entity.name}</span>
          <button type="button" onClick={() => onRemove(entity.id)} aria-label={`Remove ${entity.name}`} className="text-muted hover:text-white"><X size={13} /></button>
        </span>
      ))}
      <button type="button" onClick={onClear} className="px-2 text-[11px] font-semibold text-lime">Clear</button>
    </div>
  );
}

export function ComparePanel({ data, window, playerIds, teamIds, onTogglePlayer, onToggleTeam, onClearPlayers, onClearTeams, onBrowse }: {
  data: LeagueStats;
  window: StatsWindow;
  playerIds: string[];
  teamIds: string[];
  onTogglePlayer: (id: string) => void;
  onToggleTeam: (id: string) => void;
  onClearPlayers: () => void;
  onClearTeams: () => void;
  onBrowse: (tab: "players" | "teams") => void;
}) {
  const [mode, setMode] = useState<"players" | "teams">(playerIds.length || !teamIds.length ? "players" : "teams");
  const [chartKey, setChartKey] = useState("");
  const [trendKey, setTrendKey] = useState("");

  const players = playerIds.map((id) => data.players.find((player) => player.id === id)).filter((player): player is PlayerRow => Boolean(player));
  const teams = teamIds.map((id) => data.teams.find((team) => team.id === id)).filter((team): team is TeamRow => Boolean(team));

  const playerColumns = useMemo(() => {
    const groups = data.groups.filter((group) => players.length && players.every((player) => player.groups.includes(group.key)));
    const fallback = data.groups.filter((group) => players.some((player) => player.groups.includes(group.key)));
    const seen = new Set<string>();
    return (groups.length ? groups : fallback).flatMap((group) => group.columns).filter((column) => !seen.has(column.key) && seen.add(column.key));
  }, [data.groups, players]);

  const profiles = useQueries({
    queries: players.map((player) => ({
      queryKey: ["stats-player", data.league, player.id, window],
      queryFn: () => api.statsPlayer(data.league, player.id, window),
      staleTime: 5 * 60 * 1000,
      enabled: mode === "players",
    })),
  });

  if (mode === "players") {
    const rows: Row[] = playerColumns.map((column) => ({ ...column, values: players.map((player) => player.values[column.key] ?? null) }));
    const chartColumn: ColumnMeta | undefined = playerColumns.find((column) => column.key === chartKey) ?? playerColumns.find((column) => column.key === data.groups.find((group) => players[0]?.groups.includes(group.key))?.primary) ?? playerColumns[0];
    const loaded = profiles.map((result) => result.data).filter((profile): profile is NonNullable<typeof profile> => Boolean(profile));
    const sharedProps = loaded[0]?.propMetrics.filter((metric) => loaded.every((profile) => profile.propMetrics.some((other) => other.key === metric.key))) ?? [];
    const trendMetric = sharedProps.find((metric) => metric.key === trendKey) ?? sharedProps[0];
    const series = trendMetric ? loaded.map((profile) => ({
      name: profile.player.name,
      values: [...(profile.propMetrics.find((metric) => metric.key === trendMetric.key)?.values ?? [])].slice(0, 10).reverse(),
    })) : [];
    const entities = players.map((player) => ({ id: player.id, name: player.name, image: player.headshot, sub: `${player.teamAbbr} · ${player.position}` }));
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented label="Compare" value={mode} onChange={setMode} options={[{ value: "players", label: `Players (${players.length})` }, { value: "teams", label: `Teams (${teams.length})` }]} />
          {players.length > 0 && <Chips entities={entities} onRemove={onTogglePlayer} onClear={onClearPlayers} />}
        </div>
        {players.length < 2 ? (
          <Panel><EmptyState><span>Select at least two players (up to {MAX_COMPARE}) with the compare icon in the <button type="button" onClick={() => onBrowse("players")} className="font-semibold text-lime">Players</button> table or from a player profile.</span></EmptyState></Panel>
        ) : (
          <>
            {data.window !== "season" && <p className="text-[11px] text-muted">Values reflect the {data.window === "last10" ? "last 10 games" : "last 30 days"} where available.</p>}
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="Head to head" subtitle="Best value in each row is highlighted" flush><CompareTable entities={entities} rows={rows} /></Panel>
              <div className="space-y-4">
                <Panel title="Stat comparison" action={chartColumn ? (
                  <select aria-label="Comparison stat" value={chartColumn.key} onChange={(event) => setChartKey(event.target.value)} className={inputClass}>
                    {playerColumns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
                  </select>
                ) : undefined}>
                  {chartColumn && <CompareBarChart data={players.map((player) => ({ name: player.shortName, value: player.values[chartColumn.key] ?? null }))} format={chartColumn.format} label={chartColumn.label} />}
                </Panel>
                <Panel title="Last 10 trend" subtitle="Game-by-game from each player's log" action={sharedProps.length ? (
                  <select aria-label="Trend stat" value={trendMetric?.key ?? ""} onChange={(event) => setTrendKey(event.target.value)} className={inputClass}>
                    {sharedProps.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
                  </select>
                ) : undefined}>
                  {profiles.some((result) => result.isLoading) ? <EmptyState>Loading game logs…</EmptyState> : trendMetric ? <CompareTrendChart series={series} format={trendMetric.format} label={trendMetric.label} /> : <EmptyState>These players do not share a prop stat to chart.</EmptyState>}
                </Panel>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  const teamColumns: Row[] = [
    { key: "winPct", label: "Win percentage", short: "WIN%", format: "rate3", direction: "desc", values: teams.map((team) => team.winPct) },
    ...data.teamColumns.map((column) => ({ ...column, values: teams.map((team) => team.values[column.key] ?? null) })),
    { key: "offRank", label: "Offensive ranking", short: "OFF RK", format: "int", direction: "asc", values: teams.map((team) => team.offRank) },
    { key: "defRank", label: "Defensive ranking", short: "DEF RK", format: "int", direction: "asc", values: teams.map((team) => team.defRank) },
  ];
  const chartRow = teamColumns.find((row) => row.key === chartKey) ?? teamColumns[1] ?? teamColumns[0]!;
  const entities = teams.map((team) => ({ id: team.id, name: team.name, image: team.logo, sub: "team" }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Compare" value={mode} onChange={setMode} options={[{ value: "players", label: `Players (${players.length})` }, { value: "teams", label: `Teams (${teams.length})` }]} />
        {teams.length > 0 && <Chips entities={entities} onRemove={onToggleTeam} onClear={onClearTeams} />}
      </div>
      {teams.length < 2 ? (
        <Panel><EmptyState><span>Select at least two teams (up to {MAX_COMPARE}) with the compare icon in the <button type="button" onClick={() => onBrowse("teams")} className="font-semibold text-lime">Teams</button> table or from a team page.</span></EmptyState></Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Head to head" subtitle="Records, scoring and advanced metrics" flush>
            <CompareTable entities={entities} rows={teamColumns} />
          </Panel>
          <Panel title="Metric comparison" action={(
            <select aria-label="Comparison metric" value={chartRow.key} onChange={(event) => setChartKey(event.target.value)} className={inputClass}>
              {teamColumns.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
            </select>
          )}>
            <CompareBarChart data={teams.map((team, index) => ({ name: team.abbr, value: chartRow.values[index] ?? null }))} format={chartRow.format} label={chartRow.label} />
            <dl className="mt-4 grid gap-2 sm:grid-cols-2">
              {teams.map((team) => (
                <div key={team.id} className="rounded-xl border border-line bg-[#0e1416] p-3 text-xs">
                  <dt className="font-semibold text-white">{team.name}</dt>
                  <dd className="mt-1 text-muted">{team.record} · Home {team.home || "—"} · Away {team.away || "—"}{team.streak ? ` · ${team.streak}` : ""}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      )}
    </div>
  );
}
