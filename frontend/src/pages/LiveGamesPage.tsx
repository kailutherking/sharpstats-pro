import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { api } from "../lib/api";
import type { League } from "../lib/statsTypes";
import type { BoxGroup, LiveGame, LiveGameDetail, LiveGamesResponse } from "../lib/liveTypes";
import { inProgress } from "../lib/liveTypes";
import { Avatar, EmptyState, LoadingBlock, Panel, Segmented, thClass } from "../components/stats/StatsUi";
import { Notice } from "../components/odds/OddsUi";
import { GameTrackerHeader, type GameFilter } from "../components/live/GameTrackerHeader";
import { LineCells, LiveGameCard, SituationStrip } from "../components/live/LiveGameCard";
import { LiveOddsPanel } from "../components/live/LiveOddsPanel";
import { LivePlayerTracker } from "../components/live/LivePlayerTracker";
import { StatusBadge, WinBar } from "../components/live/liveUi";
import { LiveGameChat, PlayReactions } from "../components/live/LiveGameChat";
import { useNavStore } from "../lib/navStore";

const REFRESH_MS = 15_000;
const PERIOD_NAMES: Record<League, string> = { nba: "Q", nfl: "Q", mlb: "", nhl: "P", ncaab: "H" };

function Linescore({ game }: { game: LiveGame }) {
  const periods = Math.max(game.away.linescores.length, game.home.linescores.length);
  if (!periods) return null;
  const regulation = game.league === "mlb" ? 9 : game.league === "nhl" ? 3 : game.league === "ncaab" ? 2 : 4;
  const label = (index: number) => (game.league === "mlb" ? String(index + 1) : index < regulation ? `${PERIOD_NAMES[game.league]}${index + 1}` : index === regulation ? "OT" : `${index - regulation + 1}OT`);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] text-xs tabular-nums">
        <thead><tr className={thClass}><th className="px-2 py-1.5 text-left">TEAM</th>{Array.from({ length: periods }, (_, index) => <th key={index} className="px-2 py-1.5 text-center">{label(index)}</th>)}<th className="px-2 py-1.5 text-center text-lime">T</th></tr></thead>
        <tbody>
          {[game.away, game.home].map((team) => (
            <tr key={team.id} className="border-t border-line/60">
              <td className="px-2 py-1.5 font-semibold text-white">{team.abbr}</td>
              {Array.from({ length: periods }, (_, index) => <td key={index} className="px-2 py-1.5 text-center text-[#d9e0dc]">{team.linescores[index] ?? "—"}</td>)}
              <td className="px-2 py-1.5 text-center font-bold text-white">{team.score ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Scoreboard({ game }: { game: LiveGame }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <StatusBadge game={game} />
        <span className="text-[11px] text-muted">{[game.venue, game.broadcast].filter(Boolean).join(" · ")}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {[game.away, null, game.home].map((team, index) => team === null ? (
          <span key="vs" className="text-xs text-muted">{game.status === "pregame" ? "vs" : "–"}</span>
        ) : (
          <div key={team.id} className={`flex items-center gap-3 ${index === 2 ? "flex-row-reverse text-right" : ""}`}>
            <Avatar src={team.logo} name={team.abbr} size={44} square />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{team.name}{game.situation.possessionTeamId === team.id && inProgress(game.status) && <span className="mx-1.5 text-lime" title="Possession">●</span>}</p>
              <p className="text-[10px] text-muted">{team.record ?? ""}</p>
            </div>
            <span className="ml-auto font-display text-3xl font-extrabold tabular-nums text-white">{game.status === "pregame" ? "" : team.score ?? "—"}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        <SituationStrip game={game} league={game.league} />
        {game.situation.penalties.length > 0 && <ul className="space-y-0.5 text-[10px] text-amber-200/90">{game.situation.penalties.map((text) => <li key={text}>{text}</li>)}</ul>}
        {inProgress(game.status) && game.situation.lastPlay && <p className="rounded-lg bg-[#0e1416] px-3 py-2 text-[11px] text-[#c9d2cf]"><span className="mr-1.5 text-[9px] font-bold tracking-wider text-lime">LAST PLAY</span>{game.situation.lastPlay}</p>}
        <Linescore game={game} />
        <WinBar game={game} />
        <LineCells game={game} league={game.league} />
      </div>
    </div>
  );
}

function WinProbabilityChart({ points, game }: { points: Array<{ home: number }>; game: LiveGame }) {
  if (points.length < 2) return <EmptyState>{game.league === "nhl" ? "ESPN doesn't publish an in-game win probability for the NHL; the bar above uses the no-vig moneyline." : "The win probability chart starts once the game is underway."}</EmptyState>;
  const data = points.map((point, index) => ({ index, home: Math.round(point.home * 1000) / 10 }));
  return (
    <div className="h-[170px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
          <defs><linearGradient id="wp" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#c5f467" stopOpacity={0.35} /><stop offset="100%" stopColor="#c5f467" stopOpacity={0} /></linearGradient></defs>
          <YAxis domain={[0, 100]} ticks={[0, 50, 100]} axisLine={false} tickLine={false} tick={{ fill: "#849198", fontSize: 10 }} />
          <ReferenceLine y={50} stroke="#3a464c" strokeDasharray="4 4" />
          <Tooltip contentStyle={{ background: "#11171b", border: "1px solid #29343a", borderRadius: 12, color: "#eef2ed", fontSize: 12 }} formatter={(value: number) => [`${value}% ${game.home.abbr} · ${(100 - value).toFixed(1)}% ${game.away.abbr}`, "Win probability"]} labelFormatter={() => ""} />
          <Area type="monotone" dataKey="home" stroke="#c5f467" strokeWidth={2} fill="url(#wp)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function BoxTable({ group, onPlayer }: { group: BoxGroup; onPlayer: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-xs tabular-nums">
        <thead><tr className={`${thClass} border-b border-line`}><th className="px-3 py-2 text-left">{group.label.toUpperCase()}</th>{group.labels.map((label) => <th key={label} className="px-2 py-2 text-right">{label}</th>)}</tr></thead>
        <tbody>
          {group.players.map((player) => (
            <tr key={player.id} className="border-b border-line/50 last:border-0 hover:bg-white/[0.02]">
              <td className="px-3 py-1.5">
                <button type="button" onClick={() => onPlayer(player.id)} className="flex items-center gap-2 text-left hover:text-lime" title="Track live props">
                  <span className={`font-medium ${player.starter ? "text-white" : "text-[#c9d2cf]"}`}>{player.shortName || player.name}</span>
                  <span className="text-[10px] text-[#69757a]">{player.position}</span>
                </button>
              </td>
              {player.didNotPlay ? <td colSpan={group.labels.length} className="px-2 py-1.5 text-right text-[10px] text-muted">Did not play</td> : group.labels.map((label) => <td key={label} className="px-2 py-1.5 text-right text-[#d9e0dc]">{player.display[label] || "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MAIN_GROUPS = new Set(["players", "passing", "rushing", "receiving", "defensive", "batting", "pitching", "forwards", "defenses", "skaters", "goalies"]);

function GameDetailView({ league, gameId, onBack }: { league: League; gameId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [side, setSide] = useState<"away" | "home">("away");
  const [player, setPlayer] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [message, setMessage] = useState("");
  const key = ["live-game", league, gameId];
  const detail = useQuery({
    queryKey: key,
    queryFn: () => api.liveGame(league, gameId),
    refetchInterval: (state) => (state.state.data?.game.status === "final" ? false : REFRESH_MS),
  });
  const data = detail.data;
  async function refresh() {
    setRefreshing(true);
    try { queryClient.setQueryData<LiveGameDetail>(key, await api.liveGame(league, gameId, true)); } catch (error) { setMessage(error instanceof Error ? error.message : "Refresh failed"); } finally { setRefreshing(false); }
  }
  async function loadMarkets() {
    if (!data?.odds.oddsGameId) return;
    setLoadingMarkets(true);
    try {
      await api.oddsGame(league, data.odds.oddsGameId, true);
      await detail.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load markets");
    } finally {
      setLoadingMarkets(false);
    }
  }
  if (detail.isLoading) return <LoadingBlock label="Loading game…" />;
  if (detail.error || !data) return <Notice tone="error">{detail.error instanceof Error ? detail.error.message : "Could not load this game."} <button type="button" onClick={onBack} className="ml-2 underline">Back to games</button></Notice>;
  const game = data.game;
  const teamBox = data.box.find((team) => team.teamId === (side === "away" ? game.away.id : game.home.id));
  const teamName = (id: string) => (id === game.home.id ? game.home.abbr : game.away.abbr);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs text-muted hover:text-white"><ArrowLeft size={14} />All games</button>
        <GameTrackerHeaderInline fetchedAt={data.fetchedAt} refreshing={refreshing} onRefresh={() => void refresh()} live={inProgress(game.status)} />
      </div>
      {message && <Notice>{message}</Notice>}
      {data.stale && <Notice tone="warn">ESPN did not respond. Showing the last update.</Notice>}
      <Scoreboard game={game} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Win probability" subtitle={game.winProbability ? `${game.home.abbr} ${(game.winProbability.home * 100).toFixed(1)}% · ${game.winProbability.source}` : "Not available"}>
          <WinProbabilityChart points={data.winProbability} game={game} />
        </Panel>
        <Panel title="Player leaders" subtitle="Tap a player in the box score to track live props">
          {data.leaders.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {data.leaders.map((leader) => (
                <button key={`${leader.teamId}-${leader.category}`} type="button" onClick={() => setPlayer(leader.playerId)} className="flex items-center gap-2.5 rounded-xl border border-line bg-[#0e1416] p-2.5 text-left hover:border-[#536048]">
                  <Avatar src={leader.headshot} name={leader.name} size={32} />
                  <div className="min-w-0"><p className="text-[9px] uppercase tracking-wider text-muted">{teamName(leader.teamId)} · {leader.label}</p><p className="truncate text-xs font-semibold text-white">{leader.name}</p><p className="truncate text-[10px] text-[#c9d2cf]">{leader.value}</p></div>
                </button>
              ))}
            </div>
          ) : <EmptyState>Leaders appear once the game starts.</EmptyState>}
        </Panel>
      </div>
      {data.teamStats.length > 0 && (
        <Panel title="Live team stats" flush>
          <table className="w-full text-xs tabular-nums">
            <thead><tr className={`${thClass} border-b border-line`}><th className="px-4 py-2 text-right">{game.away.abbr}</th><th className="px-4 py-2 text-center">STAT</th><th className="px-4 py-2 text-left">{game.home.abbr}</th></tr></thead>
            <tbody>{data.teamStats.map((line) => <tr key={line.key} className="border-b border-line/50 last:border-0"><td className="px-4 py-1.5 text-right font-semibold text-white">{line.away}</td><td className="px-4 py-1.5 text-center text-[11px] text-muted">{line.label}</td><td className="px-4 py-1.5 text-left font-semibold text-white">{line.home}</td></tr>)}</tbody>
          </table>
        </Panel>
      )}
      <Panel title="Box score" subtitle="Player current stats · tap a name for projected finish and prop tracking" action={<Segmented label="Team" value={side} onChange={setSide} options={[{ value: "away", label: game.away.abbr }, { value: "home", label: game.home.abbr }]} />} flush>
        {teamBox?.groups.length ? teamBox.groups.filter((group) => MAIN_GROUPS.has(group.key)).map((group) => <div key={group.key} className="border-b border-line last:border-0"><BoxTable group={group} onPlayer={setPlayer} /></div>) : <EmptyState>The box score fills in once the game starts.</EmptyState>}
      </Panel>
      <LiveGameChat league={league} gameId={gameId} live={inProgress(game.status)} />
      <LiveOddsPanel odds={data.odds} game={game} league={league} onLoadMarkets={() => void loadMarkets()} loadingMarkets={loadingMarkets} />
      {data.plays.length > 0 && (
        <Panel title="Recent plays">
          <ul className="space-y-1.5">{data.plays.map((play) => <li key={play.id} className={`flex gap-3 text-[11px] ${play.scoring ? "text-white" : "text-[#a2abad]"}`}><span className="w-16 shrink-0 tabular-nums text-muted">{play.period ? `${game.league === "mlb" ? "Inn" : game.league === "nhl" ? "P" : "Q"}${play.period}` : ""} {play.clock ?? ""}</span><span>{play.scoring && <span className="mr-1 text-lime">●</span>}{play.text}{play.id && <PlayReactions league={league} gameId={gameId} playId={play.id} />}</span></li>)}</ul>
        </Panel>
      )}
      <p className="text-[10px] text-[#69757a]">Source: {data.source}. Live data refreshes every {data.refreshSeconds} seconds while a game is in progress. Informational only.</p>
      {player && <LivePlayerTracker league={league} gameId={gameId} playerId={player} onClose={() => setPlayer(null)} />}
    </div>
  );
}

function GameTrackerHeaderInline({ fetchedAt, refreshing, onRefresh, live }: { fetchedAt: string; refreshing: boolean; onRefresh: () => void; live: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
      <span className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2"><span className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-rose-400" : "bg-lime"}`} />{live ? "Auto-refresh every 15s" : "Not live"}</span>
      <span className="rounded-xl border border-line px-3 py-2">Last updated: <span className="text-white">{new Date(fetchedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span></span>
      <button type="button" onClick={onRefresh} disabled={refreshing} className="rounded-xl border border-line px-3 py-2 text-xs hover:text-white disabled:opacity-60">{refreshing ? "Refreshing…" : "Refresh"}</button>
    </div>
  );
}

/** Stats → Live Games: today's slate with live scores, situations, win probability and live lines. */
export function LiveGamesPage({ league }: { league: League }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<GameFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const liveTarget = useNavStore((state) => state.live);
  const consumeLive = useNavStore((state) => state.consumeLive);
  useEffect(() => {
    if (liveTarget && liveTarget.league === league) { setSelected(liveTarget.gameId); consumeLive(); }
  }, [liveTarget, league, consumeLive]);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const list = useQuery({
    queryKey: ["live-games", league],
    queryFn: () => api.liveGames(league),
    refetchInterval: REFRESH_MS,
    placeholderData: (previous) => (previous?.league === league ? previous : undefined),
    enabled: !selected,
  });
  const data = list.data?.league === league ? list.data : undefined;
  const games = useMemo(() => (data?.games ?? []).filter((game) => filter === "all" || (filter === "live" ? inProgress(game.status) : game.status === filter)), [data, filter]);
  async function refresh() {
    setRefreshing(true);
    setMessage("");
    try { queryClient.setQueryData<LiveGamesResponse>(["live-games", league], await api.liveGames(league, true)); } catch (error) { setMessage(error instanceof Error ? error.message : "Refresh failed"); } finally { setRefreshing(false); }
  }
  if (selected) return <GameDetailView key={`${league}-${selected}`} league={league} gameId={selected} onBack={() => setSelected(null)} />;
  return (
    <div>
      <GameTrackerHeader counts={data?.counts} filter={filter} onFilter={setFilter} fetchedAt={data?.fetchedAt} refreshSeconds={data?.refreshSeconds ?? 15} refreshing={refreshing} onRefresh={() => void refresh()} oddsUpdatedAt={data?.oddsUpdatedAt} />
      {message && <div className="mb-4"><Notice>{message}</Notice></div>}
      {data?.stale && <div className="mb-4"><Notice tone="warn">ESPN did not respond. Showing the last update.</Notice></div>}
      {list.isLoading && !data ? <LoadingBlock label="Loading today's games…" /> : list.error && !data ? (
        <Notice tone="error">{list.error instanceof Error ? list.error.message : "Live games are unavailable."} <button type="button" onClick={() => void list.refetch()} className="ml-2 underline">Retry</button></Notice>
      ) : games.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{games.map((game) => <LiveGameCard key={game.id} game={game} league={league} onOpen={() => setSelected(game.id)} />)}</div>
      ) : (
        <div className="rounded-2xl border border-line bg-panel"><EmptyState>{filter === "live" ? "No games are live right now. Live games refresh every 15 seconds." : data?.games.length ? "No games match this filter." : "No games scheduled today for this league."}</EmptyState></div>
      )}
      {data && <p className="mt-4 text-[10px] text-[#69757a]">Source: {data.source}. Scores refresh every {data.refreshSeconds} seconds. Win probability comes from ESPN's model, or the no-vig moneyline where ESPN doesn't publish one.</p>}
    </div>
  );
}
