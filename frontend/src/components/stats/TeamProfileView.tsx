import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GitCompare, RefreshCw, Star } from "lucide-react";
import { api } from "../../lib/api";
import type { League, TeamProfile, TeamRow } from "../../lib/statsTypes";
import { formatStat, formatUpdated, shortDate } from "../../lib/statsFormat";
import { BettingInsightsPanel } from "./BettingInsightsPanel";
import { TeamScoringChart } from "./StatsCharts";
import { Avatar, EmptyState, LoadingBlock, Panel, StatTile, thClass } from "./StatsUi";
import { RankBadge } from "./TeamStatsTable";

function leagueRank(teams: TeamRow[], key: string, direction: "asc" | "desc", teamId: string): number | null {
  const ranked = teams.filter((team) => team.values[key] !== null && team.values[key] !== undefined)
    .sort((a, b) => direction === "asc" ? a.values[key]! - b.values[key]! : b.values[key]! - a.values[key]!);
  const index = ranked.findIndex((team) => team.id === teamId);
  return index === -1 ? null : index + 1;
}

export function TeamProfileView({ league, teamId, allTeams, isFavorite, onFavorite, inCompare, onCompare, onBack, onPlayer }: {
  league: League;
  teamId: string;
  allTeams: TeamRow[];
  isFavorite: boolean;
  onFavorite: (profile: TeamProfile) => void;
  inCompare: boolean;
  onCompare: () => void;
  onBack: () => void;
  onPlayer: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["stats-team", league, teamId], queryFn: () => api.statsTeam(league, teamId), refetchInterval: 15 * 60 * 1000, staleTime: 60 * 1000 });
  const [refreshing, setRefreshing] = useState(false);
  const [gameLimit, setGameLimit] = useState(10);
  const profile = query.data;
  const back = <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-white"><ArrowLeft size={14} />Back to stats</button>;

  async function refresh() {
    setRefreshing(true);
    try { queryClient.setQueryData(["stats-team", league, teamId], await api.statsTeam(league, teamId, true)); }
    catch { /* The existing data stays on screen; the next scheduled refetch retries. */ }
    finally { setRefreshing(false); }
  }

  if (query.isLoading) return <div>{back}<LoadingBlock label="Loading team profile…" /></div>;
  if (query.error || !profile) {
    return <div>{back}<div className="rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">{query.error instanceof Error ? query.error.message : "Team not found"} <button type="button" onClick={() => void query.refetch()} className="ml-2 underline">Retry</button></div></div>;
  }
  const { team } = profile;
  const chartData = [...profile.games].reverse().map((game) => ({ label: shortDate(game.date), pointsFor: game.pointsFor, pointsAgainst: game.pointsAgainst, opponent: `${game.home ? "vs" : "@"} ${game.opponentAbbr}` }));
  const total = allTeams.length || 1;
  return (
    <section>
      {back}
      <section className="overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <Avatar src={team.logo} name={team.name} size={84} square />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold tracking-[0.17em] text-lime">{team.conference.toUpperCase()}{team.division ? ` · ${team.division.toUpperCase()}` : ""}</p>
            <h2 className="mt-1.5 font-display text-2xl font-extrabold tracking-tight sm:text-[30px]">{team.name}</h2>
            <p className="mt-1 text-sm text-muted">{team.record} · {formatStat(team.winPct, "rate3")} win%{team.streak ? ` · ${team.streak}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onFavorite(profile)} aria-pressed={isFavorite} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs ${isFavorite ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-white"}`}><Star size={14} className={isFavorite ? "fill-lime" : ""} />{isFavorite ? "Favorited" : "Favorite"}</button>
            <button type="button" onClick={onCompare} aria-pressed={inCompare} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs ${inCompare ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-white"}`}><GitCompare size={14} />{inCompare ? "In compare" : "Compare"}</button>
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Record", value: team.record },
            { label: "Home", value: team.home || "—" },
            { label: "Away", value: team.away || "—" },
            { label: "Last 10", value: team.last10 || (profile.splits.find((split) => split.label === "Last 10")?.games ? profile.splits.find((split) => split.label === "Last 10")!.record : "—") },
            { label: "Offensive rank", value: team.offRank ? `#${team.offRank} of ${total}` : "—" },
            { label: "Defensive rank", value: team.defRank ? `#${team.defRank} of ${total}` : "—" },
          ].map((fact) => (
            <div key={fact.label} className="border-b border-r border-line px-5 py-3 lg:border-b-0">
              <dt className="text-[10px] uppercase tracking-wider text-muted">{fact.label}</dt>
              <dd className="mt-1 text-xs font-semibold text-white">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span>Last Updated: {formatUpdated(profile.fetchedAt)}{profile.stale ? " · provider unavailable, showing last saved data" : ""}</span>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="flex items-center gap-1.5 font-semibold text-lime disabled:opacity-60"><RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />Refresh</button>
      </div>

      <Panel title="Team metrics" subtitle={`${profile.season.displayName} regular season · rank among ${total} teams`} className="mt-4">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {profile.teamColumns.map((column) => {
            const rank = leagueRank(allTeams, column.key, column.direction, team.id);
            return <StatTile key={column.key} label={column.label} value={formatStat(team.values[column.key], column.format)} sub={rank ? <span className="flex items-center gap-1.5">League rank <RankBadge rank={rank} total={total} /></span> : undefined} />;
          })}
        </div>
        {profile.unavailableMetrics.length > 0 && <p className="mt-3 text-[10px] text-[#69757a]">{profile.unavailableMetrics.join(" and ")} {profile.unavailableMetrics.length > 1 ? "are" : "is"} not published by the connected provider, so {profile.unavailableMetrics.length > 1 ? "they are" : "it is"} not shown.</p>}
      </Panel>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.9fr)]">
        <Panel title="Scoring trend" subtitle={`${profile.pointsLabel} scored and allowed, game by game`}>
          <TeamScoringChart data={chartData} pointsLabel={profile.pointsLabel} />
        </Panel>
        <BettingInsightsPanel insights={profile.insights} subtitle="Form, streaks, totals and home/road splits" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Splits" subtitle={`Record and ${profile.pointsLabel.toLowerCase()} per game`} flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left">
              <thead><tr className={thClass}><th className="px-5 py-3">SPLIT</th><th className="px-3 py-3 text-right">G</th><th className="px-3 py-3 text-right">RECORD</th><th className="px-3 py-3 text-right">FOR</th><th className="px-3 py-3 text-right">AGAINST</th><th className="px-5 py-3 text-right">MARGIN</th></tr></thead>
              <tbody>
                {profile.splits.map((split) => (
                  <tr key={split.label} className="border-t border-line text-xs">
                    <td className="px-5 py-2.5 font-medium text-white">{split.label}</td>
                    <td className="px-3 py-2.5 text-right text-muted">{split.games}</td>
                    <td className="px-3 py-2.5 text-right text-[#d9e0dc]">{split.games ? split.record : "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{formatStat(split.pointsFor, "dec1")}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{formatStat(split.pointsAgainst, "dec1")}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{split.pointsFor !== null && split.pointsAgainst !== null ? <span className={split.pointsFor >= split.pointsAgainst ? "text-lime" : "text-rose-400"}>{formatStat(split.pointsFor - split.pointsAgainst, "signed")}</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Top players" subtitle="Team leaders by position group">
          {profile.topPlayers.length ? (
            <div className="space-y-4">
              {profile.topPlayers.map((group) => (
                <div key={group.group}>
                  <p className="mb-1.5 text-[10px] font-bold tracking-[0.14em] text-muted">{group.label.toUpperCase()} · {group.metric.short}</p>
                  {group.players.map((player) => (
                    <button key={player.id} type="button" onClick={() => onPlayer(player.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/[0.04]">
                      <Avatar src={player.headshot} name={player.name} size={26} />
                      <span className="min-w-0 flex-1 truncate text-white">{player.name}<span className="ml-1.5 text-[10px] text-muted">{player.position}</span></span>
                      <span className="font-semibold text-lime">{formatStat(player.value, group.metric.format)}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : <EmptyState>No player stats available.</EmptyState>}
        </Panel>
      </div>

      <Panel title="Recent games" subtitle="Completed regular-season games" className="mt-4" flush action={profile.games.length > gameLimit ? <button type="button" onClick={() => setGameLimit(gameLimit + 10)} className="text-[11px] font-semibold text-lime">Show more</button> : undefined}>
        {profile.games.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left">
              <thead><tr className={thClass}><th className="px-5 py-3">DATE</th><th className="px-3 py-3">OPPONENT</th><th className="px-3 py-3">RESULT</th><th className="px-3 py-3 text-right">SCORE</th><th className="px-5 py-3 text-right">TOTAL</th></tr></thead>
              <tbody>
                {profile.games.slice(0, gameLimit).map((game) => (
                  <tr key={game.eventId} className="border-t border-line text-xs">
                    <td className="px-5 py-2.5 text-muted">{shortDate(game.date)}</td>
                    <td className="px-3 py-2.5"><span className="flex items-center gap-2"><span className="text-muted">{game.home ? "vs" : "@"}</span><Avatar src={game.opponentLogo} name={game.opponentAbbr} size={20} square />{game.opponentAbbr}</span></td>
                    <td className={`px-3 py-2.5 font-semibold ${game.result === "W" ? "text-lime" : game.result === "L" ? "text-rose-400" : "text-muted"}`}>{game.result}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-white">{game.pointsFor}-{game.pointsAgainst}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-muted">{game.pointsFor + game.pointsAgainst}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>No completed games yet this season.</EmptyState>}
      </Panel>
    </section>
  );
}
