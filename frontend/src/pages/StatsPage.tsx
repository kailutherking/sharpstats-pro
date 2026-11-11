import { NcaaHub } from "../components/ncaa/NcaaHub";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock3, Download, RefreshCw, X } from "lucide-react";
import { api } from "../lib/api";
import type { FavoriteInput, FavoriteStat, League, LeaderEntry, LeagueStats, PlayerRow, TeamRow } from "../lib/statsTypes";
import { downloadCsv, formatStat, formatUpdated, WINDOW_LABELS } from "../lib/statsFormat";
import { LeagueSelector } from "../components/stats/LeagueSelector";
import { StatsSearch, matchesQuery } from "../components/stats/StatsSearch";
import { EMPTY_FILTERS, StatsFilters, type StatsFilterState } from "../components/stats/StatsFilters";
import { LeagueLeaders } from "../components/stats/LeagueLeaders";
import { PlayerStatsTable } from "../components/stats/PlayerStatsTable";
import { TeamStatsTable } from "../components/stats/TeamStatsTable";
import { PlayerProfileView } from "../components/stats/PlayerProfileView";
import { TeamProfileView } from "../components/stats/TeamProfileView";
import { ComparePanel, MAX_COMPARE } from "../components/stats/ComparePanel";
import { Avatar, LoadingBlock, Segmented } from "../components/stats/StatsUi";
import { LiveGamesPage } from "./LiveGamesPage";
import { useNavStore } from "../lib/navStore";

type Tab = "leaders" | "players" | "teams" | "compare" | "live";
type View = { kind: "hub" } | { kind: "player"; id: string } | { kind: "team"; id: string };
const LEAGUE_KEY = "sharpstats_stats_league";
const REFRESH_MS = 15 * 60 * 1000;
const emptyCompare = () => ({ nba: { players: [], teams: [] }, nfl: { players: [], teams: [] }, mlb: { players: [], teams: [] }, nhl: { players: [], teams: [] }, ncaab: { players: [], teams: [] } }) as Record<League, { players: string[]; teams: string[] }>;

function storedLeague(): League {
  try {
    const value = localStorage.getItem(LEAGUE_KEY);
    return value === "nba" || value === "nfl" || value === "mlb" || value === "nhl" || value === "ncaab" ? value : "nba";
  } catch {
    return "nba";
  }
}

export function StatsPage() {
  const queryClient = useQueryClient();
  const [league, setLeagueState] = useState<League>(storedLeague);
  const [filters, setFilters] = useState<StatsFilterState>({ window: "season", ...EMPTY_FILTERS });
  const [tab, setTab] = useState<Tab>("leaders");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>({ kind: "hub" });
  const [groupKey, setGroupKey] = useState("");
  const [compare, setCompare] = useState(emptyCompare);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const sortedPlayers = useRef<PlayerRow[]>([]);
  const liveTarget = useNavStore((state) => state.live);
  useEffect(() => {
    // Deep link from a notification: open Live games for the right league (LiveGamesPage opens the game).
    if (!liveTarget) return;
    setLeagueState(liveTarget.league);
    setTab("live");
    setView({ kind: "hub" });
  }, [liveTarget]);
  const sortedTeams = useRef<TeamRow[]>([]);

  const statsQuery = useQuery({
    queryKey: ["stats", league, filters.window],
    queryFn: () => api.stats(league, filters.window),
    refetchInterval: REFRESH_MS,
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous?.league === league ? previous : undefined,
  });
  const favoritesQuery = useQuery({ queryKey: ["stats-favorites"], queryFn: api.statsFavorites });
  const data: LeagueStats | undefined = statsQuery.data?.league === league ? statsQuery.data : undefined;

  const setLeague = (next: League) => {
    setLeagueState(next);
    setFilters((current) => ({ window: current.window, ...EMPTY_FILTERS }));
    setGroupKey("");
    setSearch("");
    setView({ kind: "hub" });
    try { localStorage.setItem(LEAGUE_KEY, next); } catch { /* Preference is optional. */ }
  };
  const open = useCallback((next: View) => {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const favorites = useMemo(() => (favoritesQuery.data?.favorites ?? []).filter((item) => item.league === league), [favoritesQuery.data, league]);
  const favoritePlayers = useMemo(() => new Set(favorites.filter((item) => item.entity_type === "player").map((item) => item.entity_id)), [favorites]);
  const favoriteTeams = useMemo(() => new Set(favorites.filter((item) => item.entity_type === "team").map((item) => item.entity_id)), [favorites]);

  async function toggleFavorite(input: Omit<FavoriteInput, "favorite">, current: boolean) {
    const key = ["stats-favorites"];
    const previous = queryClient.getQueryData<{ favorites: FavoriteStat[] }>(key);
    const next: FavoriteStat = { league: input.league, entity_type: input.entityType, entity_id: input.entityId, name: input.name, team_abbr: input.teamAbbr, image_url: input.imageUrl, created_at: new Date().toISOString() };
    queryClient.setQueryData(key, {
      favorites: current
        ? (previous?.favorites ?? []).filter((item) => !(item.league === input.league && item.entity_type === input.entityType && item.entity_id === input.entityId))
        : [next, ...(previous?.favorites ?? [])],
    });
    try {
      await api.setStatsFavorite({ ...input, favorite: !current });
    } catch (error) {
      queryClient.setQueryData(key, previous);
      setMessage(error instanceof Error ? error.message : "Could not update favorites");
    }
  }
  const favoritePlayer = (player: { id: string; name: string; teamAbbr: string; headshot: string | null }) =>
    void toggleFavorite({ league, entityType: "player", entityId: player.id, name: player.name, teamAbbr: player.teamAbbr, imageUrl: player.headshot }, favoritePlayers.has(player.id));
  const favoriteTeam = (team: { id: string; name: string; abbr: string; logo: string | null }) =>
    void toggleFavorite({ league, entityType: "team", entityId: team.id, name: team.name, teamAbbr: team.abbr, imageUrl: team.logo }, favoriteTeams.has(team.id));

  function toggleCompare(kind: "players" | "teams", id: string) {
    const selected = compare[league][kind];
    if (!selected.includes(id) && selected.length >= MAX_COMPARE) {
      setMessage(`Compare up to ${MAX_COMPARE} ${kind} at a time.`);
      return;
    }
    setCompare({ ...compare, [league]: { ...compare[league], [kind]: selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id] } });
  }

  async function refresh() {
    setRefreshing(true);
    setMessage("");
    try {
      queryClient.setQueryData(["stats", league, filters.window], await api.refreshStats(league, filters.window));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const teamMeta = useMemo(() => new Map((data?.teams ?? []).map((team) => [team.id, team])), [data]);
  const playerMatches = useCallback((player: PlayerRow) => {
    const team = teamMeta.get(player.teamId);
    return (!filters.team || player.teamId === filters.team)
      && (!filters.position || player.position === filters.position)
      && (!filters.conference || team?.conference === filters.conference)
      && (!filters.division || team?.division === filters.division)
      && (!filters.favoritesOnly || favoritePlayers.has(player.id))
      && matchesQuery(search, player.name, player.teamName, player.teamAbbr);
  }, [favoritePlayers, filters, search, teamMeta]);
  const playersById = useMemo(() => new Map((data?.players ?? []).map((player) => [player.id, player])), [data]);
  const leaderMatches = useCallback((entry: LeaderEntry) => {
    const player = playersById.get(entry.id);
    return player ? playerMatches(player) : !search && !filters.team && !filters.position && !filters.conference && !filters.division && !filters.favoritesOnly;
  }, [filters, playerMatches, playersById, search]);
  const filteredPlayers = useMemo(() => (data?.players ?? []).filter(playerMatches), [data, playerMatches]);
  const filteredTeams = useMemo(() => (data?.teams ?? []).filter((team) =>
    (!filters.team || team.id === filters.team)
    && (!filters.conference || team.conference === filters.conference)
    && (!filters.division || team.division === filters.division)
    && (!filters.favoritesOnly || favoriteTeams.has(team.id))
    && matchesQuery(search, team.name, team.abbr, team.shortName)), [data, favoriteTeams, filters, search]);

  const group = data?.groups.find((item) => item.key === groupKey) ?? data?.groups[0];
  const groupPlayers = useMemo(() => group ? filteredPlayers.filter((player) => player.groups.includes(group.key)) : [], [filteredPlayers, group]);
  const groupLabels = useMemo(() => Object.fromEntries((data?.groups ?? []).map((item) => [item.key, item.label])), [data]);
  const onSortedPlayers = useCallback((rows: PlayerRow[]) => { sortedPlayers.current = rows; }, []);
  const onSortedTeams = useCallback((rows: TeamRow[]) => { sortedTeams.current = rows; }, []);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(""), 5000); return () => clearTimeout(timer); }, [message]);

  function exportCsv() {
    if (!data) return;
    const stamp = `${league}-${data.season.year}-${filters.window}`;
    if (tab === "teams") {
      const rows = sortedTeams.current.length ? sortedTeams.current : filteredTeams;
      downloadCsv(`sharpstats-${stamp}-teams.csv`,
        ["Team", "Abbr", data.conferenceLabel, "Division", "Record", "Home", "Away", "Win%", ...data.teamColumns.map((column) => column.label), "Offensive rank", "Defensive rank"],
        rows.map((team) => [team.name, team.abbr, team.conference, team.division, team.record, team.home, team.away, formatStat(team.winPct, "rate3"), ...data.teamColumns.map((column) => formatStat(team.values[column.key], column.format)), team.offRank ?? "", team.defRank ?? ""]));
      return;
    }
    if (tab === "leaders") {
      downloadCsv(`sharpstats-${stamp}-leaders.csv`, ["Category", "Rank", "Player", "Team", "Position", "Value"],
        data.leaders.flatMap((board) => board.leaders.filter(leaderMatches).map((entry) => [board.label, entry.rank, entry.name, entry.teamAbbr, entry.position, formatStat(entry.value, board.format)])));
      return;
    }
    const exportGroup = group ?? data.groups[0]!;
    const rows = tab === "compare"
      ? compare[league].players.map((id) => playersById.get(id)).filter((player): player is PlayerRow => Boolean(player))
      : sortedPlayers.current.length ? sortedPlayers.current : groupPlayers;
    downloadCsv(`sharpstats-${stamp}-${tab === "compare" ? "compare" : exportGroup.key}.csv`,
      ["Player", "Team", "Position", ...(filters.window !== "season" ? ["Games in window"] : []), ...exportGroup.columns.map((column) => column.label)],
      rows.map((player) => [player.name, player.teamAbbr, player.position, ...(filters.window !== "season" ? [player.sample ?? ""] : []), ...exportGroup.columns.map((column) => formatStat(player.values[column.key], column.format))]));
  }

  const header = (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-2 text-[10px] font-bold tracking-[0.17em] text-lime">RESEARCH</p>
        <h2 className="font-display text-2xl font-extrabold">Stats</h2>
        <p className="mt-1.5 text-sm text-muted">Current-season player and team statistics for betting research.</p>
      </div>
      {!(view.kind === "hub" && tab === "live") && <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2.5 text-[11px] text-muted">
          <Clock3 size={13} className="text-lime" />Last Updated: <span className="text-white">{formatUpdated(data?.fetchedAt)}</span>
        </span>
        <button type="button" onClick={() => void refresh()} disabled={refreshing || !data} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-xs text-muted hover:text-white disabled:opacity-60">
          <RefreshCw size={14} className={refreshing ? "animate-spin text-lime" : ""} />Refresh
        </button>
        {view.kind === "hub" && (
          <button type="button" onClick={exportCsv} disabled={!data} className="flex items-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-xs font-bold text-[#11170c] transition hover:bg-[#d4ff85] disabled:opacity-60">
            <Download size={14} />Export CSV
          </button>
        )}
      </div>}
    </div>
  );

  const toolbar = (
    <div className="mb-4 space-y-3 rounded-2xl border border-line bg-panel p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <LeagueSelector value={league} onChange={setLeague} />
        <StatsSearch
          value={search}
          onChange={setSearch}
          players={data?.players ?? []}
          teams={data?.teams ?? []}
          onPlayer={(id) => open({ kind: "player", id })}
          onTeam={(id) => open({ kind: "team", id })}
        />
      </div>
      {view.kind === "hub" && tab !== "live" && <div className="border-t border-line pt-3"><StatsFilters data={data} value={filters} onChange={setFilters} showPosition={tab !== "teams"} /></div>}
    </div>
  );

  const notices = (
    <>
      {league === "ncaab" && view.kind === "hub" && tab !== "live" && <NcaaHub onTeam={(id) => open({ kind: "team", id })} />}
      {message && <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-xs text-muted">{message}<button type="button" onClick={() => setMessage("")} aria-label="Dismiss"><X size={14} /></button></div>}
      {statsQuery.error && !data && <div className="mb-4 rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">{statsQuery.error instanceof Error ? statsQuery.error.message : "Stats are unavailable"} <button type="button" onClick={() => void statsQuery.refetch()} className="ml-2 underline">Retry</button></div>}
      {data?.stale && <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-xs text-amber-200"><AlertTriangle size={14} />The stats provider did not respond. Showing the last saved data from {formatUpdated(data.fetchedAt)}.</div>}
    </>
  );

  if (view.kind === "player") {
    return (
      <section>
        {header}{toolbar}{notices}
        <PlayerProfileView
          key={`${league}-${view.id}`}
          league={league}
          playerId={view.id}
          window={filters.window}
          onWindow={(next) => setFilters({ ...filters, window: next })}
          isFavorite={favoritePlayers.has(view.id)}
          onFavorite={(profile) => favoritePlayer({ id: profile.player.id, name: profile.player.name, teamAbbr: profile.player.teamAbbr, headshot: profile.player.headshot })}
          inCompare={compare[league].players.includes(view.id)}
          onCompare={() => toggleCompare("players", view.id)}
          onBack={() => open({ kind: "hub" })}
          onTeam={(id) => open({ kind: "team", id })}
        />
      </section>
    );
  }
  if (view.kind === "team") {
    return (
      <section>
        {header}{toolbar}{notices}
        <TeamProfileView
          key={`${league}-${view.id}`}
          league={league}
          teamId={view.id}
          allTeams={data?.teams ?? []}
          isFavorite={favoriteTeams.has(view.id)}
          onFavorite={(profile) => favoriteTeam(profile.team)}
          inCompare={compare[league].teams.includes(view.id)}
          onCompare={() => toggleCompare("teams", view.id)}
          onBack={() => open({ kind: "hub" })}
          onPlayer={(id) => open({ kind: "player", id })}
        />
      </section>
    );
  }

  const compareCount = compare[league].players.length + compare[league].teams.length;
  return (
    <section>
      {header}{toolbar}{notices}
      {favorites.length > 0 && tab !== "live" && (
        <div className="scrollbar-hide mb-4 flex items-center gap-2 overflow-x-auto pb-1">
          <span className="shrink-0 text-[10px] font-bold tracking-[0.14em] text-muted">FAVORITES</span>
          {favorites.map((favorite) => (
            <button
              key={`${favorite.entity_type}-${favorite.entity_id}`}
              type="button"
              onClick={() => open({ kind: favorite.entity_type, id: favorite.entity_id })}
              className="flex shrink-0 items-center gap-2 rounded-xl border border-line bg-panel py-1.5 pl-1.5 pr-3 text-xs hover:border-[#536048]"
            >
              <Avatar src={favorite.image_url} name={favorite.name} size={24} square={favorite.entity_type === "team"} />
              <span className="text-white">{favorite.name}</span>
              {favorite.entity_type === "player" && favorite.team_abbr && <span className="text-[10px] text-muted">{favorite.team_abbr}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented<Tab>
          label="Stats view"
          value={tab}
          onChange={setTab}
          options={[
            { value: "leaders", label: "League leaders" },
            { value: "players", label: "Players" },
            { value: "teams", label: "Teams" },
            { value: "compare", label: compareCount ? `Compare (${compareCount})` : "Compare" },
            { value: "live", label: "Live games" },
          ]}
        />
        {data && tab !== "live" && (
          <p className="text-[11px] text-muted">
            {data.name} {data.season.displayName} · {WINDOW_LABELS[filters.window]} · auto-refresh every {data.refreshMinutes} min
          </p>
        )}
      </div>
      {data?.windowNote && tab !== "teams" && tab !== "live" && <p className="mb-4 rounded-xl border border-line bg-[#0e1416] px-4 py-3 text-[11px] leading-relaxed text-muted">{data.windowNote}</p>}

      {tab === "live" ? <LiveGamesPage league={league} /> : !data ? <LoadingBlock label={filters.window === "season" ? "Loading statistics…" : "Building form view from recent game logs…"} /> : (
        <>
          {tab === "leaders" && <LeagueLeaders boards={data.leaders} groupLabels={groupLabels} filter={leaderMatches} onPlayer={(id) => open({ kind: "player", id })} showSample={filters.window !== "season"} />}
          {tab === "players" && group && (
            <div className="overflow-hidden rounded-2xl border border-line bg-panel">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
                <div>
                  <p className="text-sm font-semibold">Player statistics <span className="ml-1 rounded bg-[#20292e] px-1.5 py-0.5 text-[10px] text-muted">{groupPlayers.length}</span></p>
                  <p className="mt-1 text-[11px] text-muted">Click a player for the full profile · use the compare icon to pick up to {MAX_COMPARE}</p>
                </div>
                {data.groups.length > 1 && <Segmented label="Position group" value={group.key} onChange={setGroupKey} options={data.groups.map((item) => ({ value: item.key, label: item.label }))} />}
              </div>
              <PlayerStatsTable
                group={group}
                players={groupPlayers}
                favorites={favoritePlayers}
                onFavorite={favoritePlayer}
                compare={compare[league].players}
                onCompare={(id) => toggleCompare("players", id)}
                onPlayer={(id) => open({ kind: "player", id })}
                showSample={filters.window !== "season"}
                onSorted={onSortedPlayers}
              />
            </div>
          )}
          {tab === "teams" && (
            <div className="overflow-hidden rounded-2xl border border-line bg-panel">
              <div className="border-b border-line px-4 py-4 sm:px-5">
                <p className="text-sm font-semibold">Team statistics <span className="ml-1 rounded bg-[#20292e] px-1.5 py-0.5 text-[10px] text-muted">{filteredTeams.length}</span></p>
                <p className="mt-1 text-[11px] text-muted">
                  Full regular season · {data.pointsLabel.toLowerCase()} per game, advanced metrics and league ranks
                  {data.unavailableMetrics.length > 0 && ` · ${data.unavailableMetrics.join(" and ")} not published by the provider`}
                </p>
              </div>
              <TeamStatsTable
                teams={filteredTeams}
                columns={data.teamColumns}
                favorites={favoriteTeams}
                onFavorite={favoriteTeam}
                compare={compare[league].teams}
                onCompare={(id) => toggleCompare("teams", id)}
                onTeam={(id) => open({ kind: "team", id })}
                onSorted={onSortedTeams}
              />
            </div>
          )}
          {tab === "compare" && (
            <ComparePanel
              data={data}
              window={filters.window}
              playerIds={compare[league].players}
              teamIds={compare[league].teams}
              onTogglePlayer={(id) => toggleCompare("players", id)}
              onToggleTeam={(id) => toggleCompare("teams", id)}
              onClearPlayers={() => setCompare({ ...compare, [league]: { ...compare[league], players: [] } })}
              onClearTeams={() => setCompare({ ...compare, [league]: { ...compare[league], teams: [] } })}
              onBrowse={setTab}
            />
          )}
          <p className="mt-4 text-[10px] text-[#69757a]">Source: {data.source}. Data is cached on the server and refreshed every {data.refreshMinutes} minutes. Statistics are informational and not betting advice.</p>
        </>
      )}
    </section>
  );
}
