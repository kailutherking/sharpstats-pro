import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, GitCompare, RefreshCw, Star } from "lucide-react";
import { api } from "../../lib/api";
import type { League, PlayerProfile, PropMetric, StatFormat, StatsWindow } from "../../lib/statsTypes";
import { average, averageFormat, downloadCsv, formatStat, formatUpdated, median, shortDate, WINDOW_LABELS } from "../../lib/statsFormat";
import { BettingInsightsPanel } from "./BettingInsightsPanel";
import { PlayerProfileCard } from "./PlayerProfileCard";
import { HistoryChart, PropTrendChart } from "./StatsCharts";
import { EmptyState, inputClass, LoadingBlock, Panel, Segmented, StatTile, thClass } from "./StatsUi";

const HISTORY_PREFERENCE = ["avgPoints", "passingYards", "rushingYards", "receivingYards", "totalTackles", "homeRuns", "OPS", "ERA", "strikeouts", "points", "savePct"];

function guessFormat(key: string, values: number[]): StatFormat {
  if (/^(ERA|WHIP|avgGoalsAgainst)$/.test(key)) return "dec2";
  if (key === "innings") return "innings";
  if (/(Pct|^avg$|^OPS$|onBase|slug)/i.test(key) && values.every((value) => value <= 1.5)) return "rate3";
  if (/Pct/i.test(key)) return "pct1";
  return values.some((value) => !Number.isInteger(value)) ? "dec1" : "int";
}

function rate(values: Array<number | null>, line: number, direction: "over" | "under") {
  const played = values.filter((value): value is number => value !== null);
  return { hits: played.filter((value) => direction === "over" ? value >= line : value <= line).length, games: played.length };
}

function HitCell({ hits, games }: { hits: number; games: number }) {
  if (!games) return <td className="px-3 py-2.5 text-right text-muted">—</td>;
  const share = hits / games;
  const color = share >= 0.7 ? "text-lime" : share <= 0.3 ? "text-rose-400" : "text-[#d9e0dc]";
  return (
    <td className="px-3 py-2.5 text-right">
      <span className={`font-semibold ${color}`}>{Math.round(share * 100)}%</span>
      <span className="ml-1 text-[10px] text-muted">{hits}/{games}</span>
    </td>
  );
}

/** Prop research table. Lines start at the milestone nearest the recent median and can be edited. */
function PropResearch({ metrics, unit, lines, setLine }: { metrics: PropMetric[]; unit: string; lines: Record<string, number>; setLine: (key: string, value: number) => void }) {
  if (!metrics.length) return <EmptyState>No prop-relevant stats are logged for this player yet.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left">
        <thead>
          <tr className={thClass}>
            <th className="px-5 py-3">STAT</th>
            <th className="px-3 py-3">LINE</th>
            <th className="px-3 py-3 text-right">L5 HIT</th>
            <th className="px-3 py-3 text-right">L10 HIT</th>
            <th className="px-3 py-3 text-right">SEASON HIT</th>
            <th className="px-3 py-3 text-right">L5 AVG</th>
            <th className="px-3 py-3 text-right">L10 AVG</th>
            <th className="px-3 py-3 text-right">SEASON</th>
            <th className="px-3 py-3 text-right">MEDIAN</th>
            <th className="px-3 py-3 text-right" title="Standard deviation over the last 10">σ L10</th>
            <th className="px-3 py-3 text-right">HIGH / LOW</th>
            <th className="px-5 py-3 text-right">HOME / AWAY</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => {
            const line = lines[metric.key] ?? metric.line ?? metric.lines[0] ?? 0;
            const played = metric.values.filter((value): value is number => value !== null);
            const avgFormat = averageFormat(metric.format);
            return (
              <tr key={metric.key} className="border-t border-line text-xs">
                <td className="px-5 py-2.5">
                  <p className="font-medium text-white">{metric.label}</p>
                  <p className="mt-0.5 text-[10px] text-muted">{metric.direction === "over" ? "Over" : "Under"} · {played.length} {unit}</p>
                </td>
                <td className="px-3 py-2.5">
                  <input
                    type="number"
                    step={metric.format === "int" ? 0.5 : 0.1}
                    min={0}
                    value={line}
                    aria-label={`${metric.label} line`}
                    onChange={(event) => setLine(metric.key, Number(event.target.value))}
                    className={`${inputClass} w-20 py-1.5`}
                  />
                </td>
                <HitCell {...rate(played.slice(0, 5), line, metric.direction)} />
                <HitCell {...rate(played.slice(0, 10), line, metric.direction)} />
                <HitCell {...rate(played, line, metric.direction)} />
                <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{formatStat(average(played.slice(0, 5)), avgFormat)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{formatStat(average(played.slice(0, 10)), avgFormat)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{formatStat(average(played), avgFormat)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{formatStat(median(played.slice(0, 10)), avgFormat)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted">{formatStat(metric.stdDev10, "dec1")}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{formatStat(metric.high10, metric.format)} / {formatStat(metric.low10, metric.format)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-[#d9e0dc]">{formatStat(metric.homeAvg, avgFormat)} / {formatStat(metric.awayAvg, avgFormat)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SplitTable({ rows, metrics, firstLabel }: { rows: PlayerProfile["splits"]["homeAway"]; metrics: PropMetric[]; firstLabel: string }) {
  if (!rows.length) return <EmptyState>No games in this window.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-left">
        <thead>
          <tr className={thClass}>
            <th className="px-5 py-3">{firstLabel}</th>
            <th className="px-3 py-3 text-right">G</th>
            {metrics.map((metric) => <th key={metric.key} className="px-3 py-3 text-right" title={metric.label}>{metric.short}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-line text-xs">
              <td className="px-5 py-2.5 font-medium text-white">{row.label}</td>
              <td className="px-3 py-2.5 text-right text-muted">{row.games}</td>
              {metrics.map((metric) => <td key={metric.key} className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{formatStat(row.averages[metric.key], averageFormat(metric.format))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlayerProfileView({ league, playerId, window, onWindow, isFavorite, onFavorite, inCompare, onCompare, onBack, onTeam }: {
  league: League;
  playerId: string;
  window: StatsWindow;
  onWindow: (window: StatsWindow) => void;
  isFavorite: boolean;
  onFavorite: (profile: PlayerProfile) => void;
  inCompare: boolean;
  onCompare: () => void;
  onBack: () => void;
  onTeam: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["stats-player", league, playerId, window],
    queryFn: () => api.statsPlayer(league, playerId, window),
    refetchInterval: 15 * 60 * 1000,
    staleTime: 60 * 1000,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [lines, setLines] = useState<Record<string, number>>({});
  const [trendStat, setTrendStat] = useState("");
  const [historyKey, setHistoryKey] = useState("");
  const [opponentLimit, setOpponentLimit] = useState(8);
  const profile = query.data;
  useEffect(() => { setLines({}); setTrendStat(""); setHistoryKey(""); setOpponentLimit(8); }, [playerId]);

  const metrics = profile?.propMetrics ?? [];
  const trendMetric = metrics.find((metric) => metric.key === trendStat) ?? metrics[0];
  const windowIds = useMemo(() => new Set(profile?.gameLog.windowEventIds ?? []), [profile]);
  const windowGames = useMemo(() => (profile?.gameLog.games ?? []).filter((game) => windowIds.has(game.eventId)), [profile, windowIds]);

  const trendPoints = useMemo(() => {
    if (!profile || !trendMetric) return [];
    const games = profile.gameLog.games.map((game, index) => ({ game, value: trendMetric.values[index] ?? null }))
      .filter((item) => windowIds.has(item.game.eventId))
      .reverse();
    return games.map((item, index) => {
      const recent = games.slice(Math.max(0, index - 4), index + 1).map((entry) => entry.value).filter((value): value is number => value !== null);
      return {
        label: shortDate(item.game.date),
        value: item.value,
        rolling: recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null,
        opponent: `${item.game.home ? "vs" : "@"} ${item.game.opponentAbbr}`,
      };
    });
  }, [profile, trendMetric, windowIds]);

  const history = useMemo(() => {
    const career = profile?.career;
    if (!career?.seasons.length) return null;
    const usable = career.columns.filter((column) => career.seasons.some((season) => season.values[column.key] !== null && season.values[column.key] !== undefined) && column.key !== "gamesPlayed" && column.key !== "games");
    const fallback = HISTORY_PREFERENCE.map((key) => usable.find((column) => column.key === key)).find(Boolean) ?? usable[0];
    const column = usable.find((item) => item.key === historyKey) ?? fallback;
    if (!column) return null;
    const values = career.seasons.map((season) => season.values[column.key]).filter((value): value is number => typeof value === "number");
    return {
      columns: usable,
      column,
      format: guessFormat(column.key, values),
      data: career.seasons.slice(-10).map((season) => ({ label: season.label, value: season.values[column.key] ?? null })),
    };
  }, [profile, historyKey]);

  async function refresh() {
    setRefreshing(true);
    setRefreshError("");
    try {
      const fresh = await api.statsPlayer(league, playerId, window, true);
      queryClient.setQueryData(["stats-player", league, playerId, window], fresh);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  function exportLog() {
    if (!profile) return;
    downloadCsv(
      `${profile.player.name.replace(/\W+/g, "-").toLowerCase()}-${league}-game-log.csv`,
      ["Date", "Home/Away", "Opponent", "Result", "Score", ...profile.gameLog.columns.map((column) => column.label)],
      windowGames.map((game) => [game.date.slice(0, 10), game.home ? "Home" : "Away", game.opponentAbbr, game.result, game.score, ...profile.gameLog.columns.map((column) => game.display[column.key] ?? "")]),
    );
  }

  const back = <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-white"><ArrowLeft size={14} />Back to stats</button>;
  if (query.isLoading) return <div>{back}<LoadingBlock label="Loading player profile…" /></div>;
  if (query.error || !profile) {
    return (
      <div>
        {back}
        <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
          {query.error instanceof Error ? query.error.message : "Player not found"} <button type="button" onClick={() => void query.refetch()} className="ml-2 underline">Retry</button>
        </div>
      </div>
    );
  }

  const recentMetrics = metrics.slice(0, 4);
  const unit = profile.group.unit;
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Segmented label="Season window" value={window} onChange={onWindow} options={(Object.keys(WINDOW_LABELS) as StatsWindow[]).map((key) => ({ value: key, label: WINDOW_LABELS[key] }))} />
        </div>
      </div>
      <PlayerProfileCard
        profile={profile}
        actions={(
          <>
            <button type="button" onClick={() => onFavorite(profile)} aria-pressed={isFavorite} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs ${isFavorite ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-white"}`}>
              <Star size={14} className={isFavorite ? "fill-lime" : ""} />{isFavorite ? "Favorited" : "Favorite"}
            </button>
            <button type="button" onClick={onCompare} aria-pressed={inCompare} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs ${inCompare ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-white"}`}>
              <GitCompare size={14} />{inCompare ? "In compare" : "Compare"}
            </button>
            {profile.player.teamId && <button type="button" onClick={() => onTeam(profile.player.teamId)} className="rounded-xl border border-line px-3 py-2 text-xs text-muted hover:text-white">Team stats</button>}
          </>
        )}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span>Last Updated: {formatUpdated(profile.fetchedAt)}{profile.stale ? " · provider unavailable, showing last saved data" : ""}</span>
        <span className="flex items-center gap-3">
          {refreshError && <span className="text-rose-400">{refreshError}</span>}
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="flex items-center gap-1.5 font-semibold text-lime disabled:opacity-60"><RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />Refresh</button>
        </span>
      </div>

      <Panel title={window === "season" ? `${profile.season.displayName} season stats` : `${WINDOW_LABELS[window]} vs season`} subtitle={`${profile.group.label} · ${window === "season" ? `${profile.gameLog.games.length} ${unit} logged` : `${windowGames.length} ${unit} in window`}`} className="mt-4">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
          {profile.seasonStats.map((stat) => (
            <StatTile
              key={stat.key}
              label={stat.short}
              value={formatStat(window === "season" ? stat.season : stat.window, stat.format)}
              sub={window === "season" ? stat.label : `Season ${formatStat(stat.season, stat.format)}`}
            />
          ))}
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.9fr)]">
        <div className="min-w-0 space-y-4">
        <Panel title="Trend chart" subtitle={`Game by game in ${WINDOW_LABELS[window].toLowerCase()} · bars clear the line in green · blue is the 5-game average`} action={metrics.length ? (
          <select aria-label="Trend stat" value={trendMetric?.key ?? ""} onChange={(event) => setTrendStat(event.target.value)} className={inputClass}>
            {metrics.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
          </select>
        ) : undefined}>
          {trendMetric ? <PropTrendChart points={trendPoints} line={lines[trendMetric.key] ?? trendMetric.line} direction={trendMetric.direction} format={trendMetric.format} label={trendMetric.label} /> : <EmptyState>No game data yet.</EmptyState>}
        </Panel>
          <Panel title="Recent performance" subtitle={`Averages over the last 5 and last 10 ${unit}, against the season`}>
            <div className="grid gap-3 md:grid-cols-2">
              {[5, 10].map((count) => (
                <div key={count} className="rounded-xl border border-line bg-[#0e1416] p-4">
                  <p className="text-xs font-semibold">Last {count} {unit}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {recentMetrics.map((metric) => {
                      const played = metric.values.filter((value): value is number => value !== null);
                      const recent = average(played.slice(0, count));
                      const season = average(played);
                      const delta = recent !== null && season ? (recent - season) / Math.abs(season) : null;
                      const good = delta !== null && (metric.direction === "over" ? delta > 0 : delta < 0);
                      return (
                        <div key={metric.key}>
                          <p className="text-[10px] text-muted">{metric.short}</p>
                          <p className="mt-1 font-display text-lg font-bold">{formatStat(recent, averageFormat(metric.format))}</p>
                          <p className={`text-[10px] ${delta === null || Math.abs(delta) < 0.02 ? "text-muted" : good ? "text-lime" : "text-rose-400"}`}>
                            {delta === null ? "—" : `${delta > 0 ? "+" : ""}${Math.round(delta * 100)}% vs season`}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
        <BettingInsightsPanel insights={profile.insights} />
      </div>


      <Panel title="Player prop research" subtitle="Edit a line to recalculate hit rates. Default lines sit at the milestone nearest the last-10 median." className="mt-4" flush>
        <PropResearch metrics={metrics} unit={unit} lines={lines} setLine={(key, value) => setLines((current) => ({ ...current, [key]: value }))} />
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Home vs away splits" subtitle={`Per-game averages · ${WINDOW_LABELS[window].toLowerCase()}`} flush>
          <SplitTable rows={profile.splits.homeAway} metrics={metrics} firstLabel="SPLIT" />
        </Panel>
        <Panel title="Opponent splits" subtitle={`Per-game averages by opponent · ${WINDOW_LABELS[window].toLowerCase()}`} flush action={profile.splits.opponents.length > opponentLimit ? <button type="button" onClick={() => setOpponentLimit(opponentLimit + 10)} className="text-[11px] font-semibold text-lime">Show more</button> : undefined}>
          <SplitTable rows={profile.splits.opponents.slice(0, opponentLimit)} metrics={metrics} firstLabel="OPPONENT" />
        </Panel>
      </div>

      <Panel title="Historical performance" subtitle={history ? `${profile.career?.category} by season` : "Career history"} className="mt-4" action={history ? (
        <select aria-label="Historical stat" value={history.column.key} onChange={(event) => setHistoryKey(event.target.value)} className={inputClass}>
          {history.columns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
        </select>
      ) : undefined}>
        {history ? <HistoryChart data={history.data} format={history.format} label={history.column.label} /> : <EmptyState>No prior seasons on record.</EmptyState>}
      </Panel>

      <Panel title="Game log" subtitle={`${profile.season.displayName} regular season · ${WINDOW_LABELS[window].toLowerCase()} · ${windowGames.length} ${unit}`} className="mt-4" flush action={(
        <button type="button" onClick={exportLog} disabled={!windowGames.length} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[11px] text-muted hover:text-white disabled:opacity-50"><Download size={13} />CSV</button>
      )}>
        {windowGames.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className={thClass}>
                  <th className="px-5 py-3">DATE</th>
                  <th className="px-3 py-3">OPP</th>
                  <th className="px-3 py-3">RESULT</th>
                  {profile.gameLog.columns.map((column) => <th key={column.key} className="whitespace-nowrap px-3 py-3 text-right">{column.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {windowGames.map((game) => (
                  <tr key={game.eventId} className="border-t border-line text-xs">
                    <td className="whitespace-nowrap px-5 py-2.5 text-muted">{shortDate(game.date)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-white"><span className="text-muted">{game.home ? "vs" : "@"}</span> {game.opponentAbbr}</td>
                    <td className="whitespace-nowrap px-3 py-2.5"><span className={game.result === "W" ? "text-lime" : game.result === "L" ? "text-rose-400" : "text-muted"}>{game.result}</span> <span className="text-muted">{game.score}</span></td>
                    {profile.gameLog.columns.map((column) => <td key={column.key} className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{game.display[column.key] || "—"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>No games in this window.</EmptyState>}
      </Panel>
      <p className="mt-4 text-[10px] text-[#69757a]">Source: {profile.source}. Statistics are informational; verify lines and availability before wagering.</p>
    </section>
  );
}
