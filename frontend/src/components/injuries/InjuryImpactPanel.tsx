import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { api } from "../../lib/api";
import type { InjuryImpact, InjuryRow, LineImpact } from "../../lib/injuryTypes";
import type { League } from "../../lib/statsTypes";
import { american, pct, signedPoint } from "../../lib/oddsFormat";
import { Avatar, EmptyState, LoadingBlock, Panel } from "../stats/StatsUi";
import { LEVEL_TONE, signed, StatusPill, TierBadge } from "./injuryUi";

/** Importance, rating/win impact and offense/defense/fantasy/prop impact for one injury. */
export function ImpactBreakdown({ impact, status }: { impact: InjuryImpact; status: InjuryRow["status"] }) {
  const tiles: Array<[string, string, string]> = [
    ["Importance", `${impact.importance}/100`, impact.tier],
    ["Team rating change", `${signed(impact.ratingChange)} ${impact.ratingUnit}`, "per game while out"],
    ["Projected impact", `${signed(impact.expectedRatingChange)} ${impact.ratingUnit}`, `${status} · ${Math.round(impact.statusWeight * 100)}% weight`],
    ["Est. win impact", pct(impact.winImpact, 1), "next game win probability"],
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(([label, value, sub], index) => (
          <div key={label} className={`rounded-xl border p-3 ${index === 0 ? "border-[#34412a] bg-[#182017]" : "border-line bg-[#0e1416]"}`}>
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted">{label}</p>
            <p className={`mt-1 font-display text-base font-bold tabular-nums ${index === 0 ? "text-lime" : "text-white"}`}>{value}</p>
            <p className="mt-0.5 text-[10px] text-muted">{sub}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {[["Offensive", impact.offensive.level, `${signed(impact.offensive.change)} ${impact.ratingUnit}`], ["Defensive", impact.defensive.level, `${signed(impact.defensive.change)} ${impact.ratingUnit}`],
          ["Fantasy", impact.fantasy.level, impact.fantasy.perGame === null ? "—" : `${impact.fantasy.perGame} pts/g${impact.fantasy.percentile !== null ? ` · ${Math.round(impact.fantasy.percentile * 100)}th pct` : ""}`],
          ["Prop betting", impact.prop.level, impact.prop.markets.slice(0, 3).join(", ")]].map(([label, level, sub]) => (
          <div key={label} className="rounded-xl border border-line bg-[#0e1416] p-3">
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted">{label} impact</p>
            <p className={`mt-1 text-sm font-bold ${LEVEL_TONE[level as InjuryImpact["prop"]["level"]]}`}>{level}</p>
            <p className="mt-0.5 truncate text-[10px] text-muted" title={sub}>{sub}</p>
          </div>
        ))}
      </div>
      {impact.prop.beneficiaries.length > 0 && (
        <p className="text-[11px] text-muted">Likely usage boost: {impact.prop.beneficiaries.map((player) => <span key={player.id} className="mr-2 text-[#d9e0dc]">{player.name} <span className="text-[#69757a]">({player.value} {player.stat})</span></span>)}</p>
      )}
      <p className="text-[10px] leading-relaxed text-[#69757a]">Basis: {impact.basis} Estimates from season statistics against a replacement-level player; not a trained model.</p>
    </div>
  );
}

/** Before vs current spread on the team's next game, with the books that moved. */
export function LineImpactCard({ line }: { line: LineImpact | null }) {
  if (!line) return <p className="text-[11px] text-muted">No upcoming game with tracked odds for this team.</p>;
  const Icon = line.direction === "against" ? ArrowDownRight : line.direction === "toward" ? ArrowUpRight : Minus;
  const tone = line.direction === "against" ? "text-rose-400" : line.direction === "toward" ? "text-lime" : "text-muted";
  return (
    <div className="rounded-xl border border-line bg-[#0e1416] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-white">{line.game}</p>
        <span className="text-[10px] text-muted">{new Date(line.commenceTime).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
      </div>
      <p className={`mt-1.5 flex items-start gap-1.5 text-[11px] ${tone}`}><Icon size={13} className="mt-0.5 shrink-0" />{line.message}</p>
      {line.before && line.current && (
        <div className="mt-2.5 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg border border-line px-2 py-1.5"><p className="text-[9px] uppercase tracking-wider text-[#69757a]">{line.baseline === "report" ? "Before line" : "First tracked"}</p><p className="text-sm font-semibold tabular-nums text-white">{signedPoint(line.before.point)} <span className="text-[10px] text-muted">{american(line.before.american)}</span></p></div>
          <div className="rounded-lg border border-line px-2 py-1.5"><p className="text-[9px] uppercase tracking-wider text-[#69757a]">Current line</p><p className="text-sm font-semibold tabular-nums text-white">{signedPoint(line.current.point)} <span className="text-[10px] text-muted">{american(line.current.american)}</span></p></div>
        </div>
      )}
      {line.affectedBooks.length > 0 && <p className="mt-2 text-[10px] text-muted">Affected sportsbooks: {line.affectedBooks.map((book) => `${book.name} ${signedPoint(book.before)} → ${signedPoint(book.current)}`).join(" · ")}</p>}
    </div>
  );
}

/** Key injuries for a league with the spread movement on each team's next game. Used on the Injury Report and Odds screen. */
export function InjuryImpactPanel({ league, onPlayer, limit = 8, title = "Injury impact on the odds" }: { league: League; onPlayer?: (row: InjuryRow) => void; limit?: number; title?: string }) {
  const query = useQuery({ queryKey: ["injury-impact", league, limit], queryFn: () => api.injuryImpact(league, 30, limit), refetchInterval: 5 * 60_000 });
  const impacts = query.data?.league === league ? query.data.impacts : [];
  return (
    <Panel title={title} subtitle="Key players out or uncertain, and how their team's spread has moved since the report">
      {query.isLoading ? <LoadingBlock label="Loading key injuries…" /> : impacts.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {impacts.map(({ injury, line }) => (
            <div key={injury.athleteId} className="space-y-2 rounded-xl border border-line p-3">
              <button type="button" onClick={() => onPlayer?.(injury)} disabled={!onPlayer} className="flex w-full items-center gap-2.5 text-left">
                <Avatar src={injury.headshot} name={injury.name} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">{injury.name} <span className="font-normal text-muted">· {injury.teamAbbr} {injury.position}</span></p>
                  <p className="truncate text-[10px] text-muted">{injury.injury} · {signed(injury.impact.ratingChange)} {injury.impact.ratingUnit}/game</p>
                </div>
                <StatusPill status={injury.status} />
                <TierBadge tier={injury.impact.tier} />
              </button>
              <LineImpactCard line={line} />
            </div>
          ))}
        </div>
      ) : <EmptyState>No high-impact injuries for this league right now.</EmptyState>}
    </Panel>
  );
}
