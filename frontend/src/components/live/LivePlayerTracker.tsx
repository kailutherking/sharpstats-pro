import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "../../lib/api";
import type { League } from "../../lib/statsTypes";
import type { PlayerPropTrack } from "../../lib/liveTypes";
import { american, pct } from "../../lib/oddsFormat";
import { Avatar, EmptyState, inputClass, LoadingBlock } from "../stats/StatsUi";
import { Notice } from "../odds/OddsUi";
import { StatusBadge } from "./liveUi";

const fmt = (value: number | null, digits = 1) => (value === null ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(digits));

function Bar({ value, tone }: { value: number; tone: "lime" | "sky" }) {
  return <div className="h-1.5 overflow-hidden rounded-full bg-[#1b2428]"><div className={`h-full rounded-full ${tone === "lime" ? "bg-lime" : "bg-sky-300"}`} style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} /></div>;
}

function PropCard({ prop, onLine }: { prop: PlayerPropTrack; onLine: (line: number | null) => void }) {
  const [draft, setDraft] = useState(prop.line === null ? "" : String(prop.line));
  useEffect(() => { setDraft(prop.line === null ? "" : String(prop.line)); }, [prop.line]);
  const probability = prop.hitProbability;
  const verdict = probability === null ? null : probability >= 0.6 ? "text-lime" : probability <= 0.4 ? "text-rose-400" : "text-amber-300";
  const remaining = prop.line !== null && prop.current !== null ? Math.max(0, prop.line - prop.current) : null;
  return (
    <div className="rounded-xl border border-line bg-[#0e1416] p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-white">{prop.label} prop</p>
          <p className="text-[10px] text-muted">{prop.lineSource ? `Line from ${prop.lineSource}${prop.overPrice !== null ? ` · O ${american(prop.overPrice)} / U ${american(prop.underPrice)}` : ""}` : "Enter a line to track"}</p>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); const value = Number(draft); onLine(draft === "" || !Number.isFinite(value) ? null : value); }} className="flex items-center gap-1">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} inputMode="decimal" aria-label={`${prop.label} line`} placeholder="Line" className={`${inputClass} w-16 py-1 text-right`} />
          <button type="submit" className="rounded-md border border-line px-2 py-1 text-[10px] text-muted hover:text-white">Set</button>
        </form>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        {[["Line", fmt(prop.line)], ["Current", fmt(prop.current, 0)], ["Projected", fmt(prop.projected)], ["Hit prob.", probability === null ? "—" : pct(probability, 0)]].map(([label, value], index) => (
          <div key={label}>
            <p className="text-[9px] uppercase tracking-wider text-[#69757a]">{label}</p>
            <p className={`font-display text-base font-bold tabular-nums ${index === 3 && verdict ? verdict : "text-white"}`}>{value}</p>
          </div>
        ))}
      </div>
      {prop.line !== null && prop.current !== null && (
        <div className="mt-3 space-y-2">
          <div><div className="mb-1 flex justify-between text-[10px] text-muted"><span>Over progress</span><span className="tabular-nums">{fmt(prop.current, 0)} / {fmt(prop.line)}</span></div><Bar value={prop.overProgress ?? 0} tone="lime" /></div>
          <div><div className="mb-1 flex justify-between text-[10px] text-muted"><span>Under cushion</span><span className="tabular-nums">{remaining === null ? "—" : `${fmt(remaining)} left`}</span></div><Bar value={prop.underCushion ?? 0} tone="sky" /></div>
        </div>
      )}
      <p className="mt-2.5 text-[10px] leading-relaxed text-muted">
        {prop.pace !== null ? `On pace for ${fmt(prop.pace)}` : "Pace starts after a few minutes of play"}
        {prop.seasonAverage !== null ? ` · season avg ${fmt(prop.seasonAverage)}` : ""}
        {prop.needed !== null && prop.needed > 0 ? ` · needs ${prop.needed} more for the over` : prop.needed === 0 ? " · over already cashed" : ""}
      </p>
    </div>
  );
}

/** Live player view: current game stats, projected finish and prop hit probability. */
export function LivePlayerTracker({ league, gameId, playerId, onClose }: { league: League; gameId: string; playerId: string; onClose: () => void }) {
  const [custom, setCustom] = useState<{ stat: string; line: number } | null>(null);
  const query = useQuery({
    queryKey: ["live-player", league, gameId, playerId, custom?.stat, custom?.line],
    queryFn: () => api.livePlayer(league, gameId, playerId, custom?.stat, custom?.line),
    refetchInterval: (state) => (state.state.data?.game.status === "final" ? false : 15_000),
    placeholderData: (previous) => previous,
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const data = query.data;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label="Live player performance" onClick={onClose}>
      <div className="h-full w-full max-w-[720px] overflow-y-auto border-l border-line bg-canvas p-4 sm:p-6" onClick={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar src={data?.player.headshot} name={data?.player.name ?? "Player"} size={52} />
            <div>
              <p className="mb-1 text-[10px] font-bold tracking-[0.17em] text-lime">LIVE PLAYER PERFORMANCE</p>
              <h3 className="font-display text-lg font-bold">{data?.player.name ?? "Loading player…"}</h3>
              {data && <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">{data.player.teamAbbr} · {data.player.position || "—"} · {data.game.shortName} <StatusBadge game={{ ...data.game, startTime: new Date().toISOString() }} /></p>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border border-line p-2 text-muted hover:text-white"><X size={15} /></button>
        </div>
        {query.isLoading ? <LoadingBlock label="Loading live player stats…" /> : query.error ? <Notice tone="error">{query.error instanceof Error ? query.error.message : "Could not load this player."}</Notice> : data ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-panel p-4">
              <div className="mb-2 flex justify-between text-[10px] text-muted"><span>Game progress</span><span>{pct(data.progress, 0)}</span></div>
              <Bar value={data.progress} tone="lime" />
            </div>
            <div className="rounded-2xl border border-line bg-panel">
              <p className="border-b border-line px-4 py-3 text-sm font-semibold">Current game stats</p>
              {data.stats.map((group) => (
                <div key={group.group} className="overflow-x-auto border-b border-line/60 px-4 py-3 last:border-0">
                  {data.stats.length > 1 && <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">{group.label}</p>}
                  <div className="flex gap-4">{Object.entries(group.display).map(([label, value]) => <div key={label} className="text-center"><p className="text-[9px] text-[#69757a]">{label}</p><p className="text-sm font-semibold tabular-nums text-white">{value || "—"}</p></div>)}</div>
                </div>
              ))}
            </div>
            {!data.propsLoaded && <Notice>Sportsbook prop lines for this player aren't loaded. Use “Load quarter markets & props” in the game view, or type your own line below.</Notice>}
            {data.props.length ? (
              <div className="grid gap-3 sm:grid-cols-2">{data.props.map((prop) => <PropCard key={prop.key} prop={prop} onLine={(line) => setCustom(line === null ? null : { stat: prop.key, line })} />)}</div>
            ) : <EmptyState>No trackable prop stats for this player's role.</EmptyState>}
            <p className="text-[10px] leading-relaxed text-[#69757a]">Projected finish blends the season average with tonight's pace (by minutes for NBA, by game clock elsewhere) and trusts tonight more as the game goes on. Hit probability models the remaining production as a Poisson or normal distribution. Estimates only, not betting advice.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
