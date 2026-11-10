import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock3, Download, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import type { InjuryReport, InjuryRow, InjuryStatus } from "../lib/injuryTypes";
import type { League } from "../lib/statsTypes";
import { downloadCsv, formatUpdated } from "../lib/statsFormat";
import { LoadingBlock, Panel, StatTile } from "../components/stats/StatsUi";
import { Notice } from "../components/odds/OddsUi";
import { EMPTY_INJURY_FILTERS, InjuryFilters, type InjuryFilterState } from "../components/injuries/InjuryFilters";
import { InjuryTable } from "../components/injuries/InjuryTable";
import { TeamHealthDashboard } from "../components/injuries/TeamHealthDashboard";
import { InjuryImpactPanel, LineImpactCard } from "../components/injuries/InjuryImpactPanel";
import { PlayerInjuryProfile } from "../components/injuries/PlayerInjuryProfile";

const LEAGUE_KEY = "sharpstats_injury_league";

function storedLeague(): League {
  try {
    const value = localStorage.getItem(LEAGUE_KEY);
    return value === "nba" || value === "nfl" || value === "mlb" || value === "nhl" ? value : "nba";
  } catch {
    return "nba";
  }
}

function TeamFocus({ league, teamId }: { league: League; teamId: string }) {
  const team = useQuery({ queryKey: ["injury-team", league, teamId], queryFn: () => api.injuryTeam(league, teamId) });
  if (!team.data) return null;
  const { team: health, line } = team.data;
  return (
    <Panel title={`${health.teamName} injury dashboard`} subtitle={`Health score ${health.score}/100 · ${health.label}`}>
      <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
          <StatTile label="Active injuries" value={String(health.active)} />
          <StatTile label="Questionable" value={String(health.questionable)} />
          <StatTile label="Returning" value={String(health.returning)} highlight={health.returning > 0} />
          <StatTile label="Suspended" value={String(health.suspended)} />
        </div>
        <LineImpactCard line={line} />
      </div>
    </Panel>
  );
}

/** Research → Injury Report: live injury feed for four leagues with betting impact and odds movement. */
export function InjuryReportPage() {
  const queryClient = useQueryClient();
  const [league, setLeagueState] = useState<League>(storedLeague);
  const [filters, setFilters] = useState<InjuryFilterState>(EMPTY_INJURY_FILTERS);
  const [profile, setProfile] = useState<InjuryRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const key = ["injuries", league];
  const report = useQuery({
    queryKey: key,
    queryFn: () => api.injuries({ league }),
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
  const data: InjuryReport | undefined = report.data?.league === league ? report.data : undefined;
  const setLeague = (next: League) => {
    setLeagueState(next);
    setFilters(EMPTY_INJURY_FILTERS);
    try { localStorage.setItem(LEAGUE_KEY, next); } catch { /* optional */ }
  };
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(""), 5000); return () => clearTimeout(timer); }, [message]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = filters.q.trim().toLowerCase();
    const window = { "24h": 86_400_000, "3d": 3 * 86_400_000, "7d": 7 * 86_400_000, all: Infinity }[filters.updated];
    return data.injuries.filter((row) => (!filters.team || row.teamId === filters.team)
      && (!filters.position || row.position === filters.position)
      && (filters.statuses.length ? filters.statuses.includes(row.status) : row.status !== "Active")
      && Date.now() - Date.parse(row.reportedAt) <= window
      && (!q || `${row.name} ${row.teamName} ${row.teamAbbr} ${row.injury}`.toLowerCase().includes(q)));
  }, [data, filters]);

  async function refresh() {
    setRefreshing(true);
    try {
      queryClient.setQueryData(key, await api.injuries({ league, refresh: true }));
      await queryClient.invalidateQueries({ queryKey: ["injury-impact", league] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  function exportCsv() {
    downloadCsv(`sharpstats-injuries-${league}.csv`, ["Player", "Team", "Position", "Injury", "Status", "Expected return", "Last updated", "Source", "Importance", "Impact tier", "Rating change", "Win impact", "Prop impact", "Note"],
      rows.map((row) => [row.name, row.teamName, row.position, row.injury, row.status, row.returnDate ?? "", row.reportedAt, row.source, row.impact.importance, row.impact.tier,
        `${row.impact.ratingChange} ${row.impact.ratingUnit}`, row.impact.winImpact, row.impact.prop.level, row.shortComment]));
  }

  const count = (statuses: InjuryStatus[]) => statuses.reduce((total, status) => total + (data?.counts[status] ?? 0), 0);
  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] font-bold tracking-[0.17em] text-lime">RESEARCH</p>
          <h2 className="font-display text-2xl font-extrabold">Injury report</h2>
          <p className="mt-1.5 text-sm text-muted">Live injury reports with betting impact, team health and odds movement.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2.5 text-[11px] text-muted"><Clock3 size={13} className="text-lime" />Last Updated: <span className="text-white">{formatUpdated(data?.fetchedAt)}</span></span>
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-xs text-muted hover:text-white disabled:opacity-60"><RefreshCw size={14} className={refreshing ? "animate-spin text-lime" : ""} />Refresh</button>
          <button type="button" onClick={exportCsv} disabled={!rows.length} className="flex items-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-xs font-bold text-[#11170c] transition hover:bg-[#d4ff85] disabled:opacity-60"><Download size={14} />Export CSV</button>
        </div>
      </div>
      <InjuryFilters league={league} onLeague={setLeague} value={filters} onChange={setFilters} teams={data?.filters.teams ?? []} positions={data?.filters.positions ?? []} statuses={data?.filters.statuses ?? []} counts={data?.counts ?? {}} />
      {message && <div className="mb-4"><Notice>{message}</Notice></div>}
      {data?.stale && <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-xs text-amber-200"><AlertTriangle size={14} />The injury feed did not respond. Showing the report from {formatUpdated(data.fetchedAt)}.</div>}
      {report.isLoading && !data ? <LoadingBlock label="Loading injury reports…" /> : report.error && !data ? (
        <Notice tone="error">{report.error instanceof Error ? report.error.message : "Injury reports are unavailable."} <button type="button" onClick={() => void report.refetch()} className="ml-2 underline">Retry</button></Notice>
      ) : data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Out" value={String(count(["Out", "Inactive"]))} />
            <StatTile label="Doubtful / Questionable" value={String(count(["Doubtful", "Questionable", "Game Time Decision"]))} />
            <StatTile label="Day-to-day / Probable" value={String(count(["Day-to-Day", "Probable"]))} />
            <StatTile label="Injured reserve" value={String(count(["Injured Reserve"]))} />
            <StatTile label="Suspended" value={String(count(["Suspended"]))} />
            <StatTile label="Returning" value={String(count(["Active"]))} highlight={count(["Active"]) > 0} />
          </div>
          <InjuryImpactPanel league={league} onPlayer={setProfile} limit={6} title="Key injuries & odds impact" />
          {filters.team && <TeamFocus league={league} teamId={filters.team} />}
          <Panel title="Team health" subtitle="100 = fully healthy · each absence lowers the score by its importance and status · select a team to filter">
            <TeamHealthDashboard teams={data.teams} selected={filters.team} onSelect={(team) => setFilters({ ...filters, team })} />
          </Panel>
          <Panel title="Injury report" subtitle={`${rows.length} of ${data.total} listed players · sorted by projected impact · click a player for details`} flush>
            <InjuryTable rows={rows} onPlayer={setProfile} />
          </Panel>
          <p className="text-[10px] text-[#69757a]">Source: {data.source}. Reports refresh every {data.refreshMinutes} minutes. Impact ratings are estimates from season statistics, not betting advice.</p>
        </div>
      ) : null}
      {profile && <PlayerInjuryProfile league={league} row={profile} onClose={() => setProfile(null)} />}
    </section>
  );
}
