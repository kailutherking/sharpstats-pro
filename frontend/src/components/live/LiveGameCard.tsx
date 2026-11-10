import { Siren } from "lucide-react";
import type { League } from "../../lib/statsTypes";
import type { LiveGame, LiveTeam } from "../../lib/liveTypes";
import { american, signedPoint } from "../../lib/oddsFormat";
import { Avatar } from "../stats/StatsUi";
import { CountDots, Diamond, isLive, SPREAD_LABEL, StatusBadge, WinBar } from "./liveUi";

function TeamRow({ team, game, side }: { team: LiveTeam; game: LiveGame; side: "home" | "away" }) {
  const hasBall = game.situation.possessionTeamId === team.id && isLive(game.status);
  const other = side === "home" ? game.away : game.home;
  const leading = game.status !== "pregame" && team.score !== null && other.score !== null && team.score > other.score;
  return (
    <div className="flex items-center gap-2.5">
      <Avatar src={team.logo} name={team.abbr} size={26} square />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${leading || team.winner ? "font-bold text-white" : "font-medium text-[#d9e0dc]"}`}>
          {team.shortName || team.name}
          {hasBall && <span className="ml-1.5 text-[10px] text-lime" title="Possession">●</span>}
        </p>
        <p className="text-[10px] text-muted">{team.record ?? team.abbr}</p>
      </div>
      <span className={`font-display text-xl font-extrabold tabular-nums ${leading || team.winner ? "text-white" : "text-[#9aa5aa]"}`}>{game.status === "pregame" ? "" : team.score ?? "—"}</span>
    </div>
  );
}

/** League-specific live context: fouls/timeouts, down and distance, count and runners, power play. */
export function SituationStrip({ game, league }: { game: LiveGame; league: League }) {
  const s = game.situation;
  if (!isLive(game.status)) return null;
  if (league === "nfl" && (s.downDistance || s.possessionText)) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {s.downDistance && <span className="font-semibold text-white">{s.downDistance}</span>}
        {s.possessionText && <span className="text-muted">{s.possessionText}</span>}
        {s.isRedZone && <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold text-rose-300"><Siren size={10} />RED ZONE</span>}
      </div>
    );
  }
  if (league === "mlb") {
    return (
      <div className="flex items-center gap-3">
        <Diamond first={s.onFirst} second={s.onSecond} third={s.onThird} size={30} />
        <div className="flex flex-col gap-1">
          <span className="flex gap-2"><CountDots label="B" value={s.balls} max={3} /><CountDots label="S" value={s.strikes} max={2} tone="amber" /><CountDots label="O" value={s.outs} max={2} tone="rose" /></span>
          <span className="truncate text-[10px] text-muted">{s.pitcher ? `P: ${s.pitcher.name}${s.pitcher.summary ? ` (${s.pitcher.summary})` : ""}` : ""}{s.batter ? ` · AB: ${s.batter.name}` : ""}</span>
        </div>
      </div>
    );
  }
  if (league === "nhl") {
    const pp = s.powerPlay;
    const team = pp ? (pp.teamId === game.home.id ? game.home : game.away) : null;
    return (
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span>SOG <span className="font-semibold text-white">{game.away.shots ?? "—"}</span>–<span className="font-semibold text-white">{game.home.shots ?? "—"}</span></span>
        {pp && team && <span className="rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">{team.abbr} POWER PLAY {pp.strength}{pp.timeRemaining ? ` · ${pp.timeRemaining}` : ""}</span>}
      </div>
    );
  }
  if (league === "nba") {
    const show = game.home.timeouts !== null || game.home.fouls !== null;
    if (!show) return null;
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted">
        {[game.away, game.home].map((team) => (
          <span key={team.id}>{team.abbr}: TO <span className="text-white">{team.timeouts ?? "—"}</span> · Fouls <span className="text-white">{team.fouls ?? "—"}</span>{team.inBonus ? <span className="ml-1 text-amber-300">BONUS</span> : null}</span>
        ))}
      </div>
    );
  }
  return null;
}

export function LineCells({ game, league }: { game: LiveGame; league: League }) {
  const { lines } = game;
  const cell = (label: string, top: string, bottom: string) => (
    <div className="rounded-lg border border-line bg-[#0c1114] px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wider text-[#69757a]">{label}</p>
      <p className="mt-0.5 text-[11px] tabular-nums text-white">{top}</p>
      <p className="text-[11px] tabular-nums text-white">{bottom}</p>
    </div>
  );
  if (!lines.source) return <p className="text-[10px] text-muted">{game.status === "final" ? "Betting closed." : "No betting lines posted yet."}</p>;
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {cell("Moneyline", `${game.away.abbr} ${american(lines.moneyline?.away)}`, `${game.home.abbr} ${american(lines.moneyline?.home)}`)}
      {cell(SPREAD_LABEL[league], `${signedPoint(lines.spread?.awayLine) || "—"} ${american(lines.spread?.awayOdds)}`, `${signedPoint(lines.spread?.homeLine) || "—"} ${american(lines.spread?.homeOdds)}`)}
      {cell("Total", `O ${lines.total?.line ?? "—"} ${american(lines.total?.over)}`, `U ${lines.total?.line ?? "—"} ${american(lines.total?.under)}`)}
    </div>
  );
}

export function LiveGameCard({ game, league, onOpen }: { game: LiveGame; league: League; onOpen: () => void }) {
  const live = isLive(game.status);
  return (
    <button type="button" onClick={onOpen} className={`flex w-full flex-col gap-3 rounded-2xl border bg-panel p-4 text-left transition hover:border-[#536048] ${live ? "border-[#34412a]" : "border-line"}`}>
      <div className="flex items-center justify-between gap-2">
        <StatusBadge game={game} />
        <span className="truncate text-[10px] text-muted">{game.broadcast ?? game.venue ?? ""}</span>
      </div>
      <div className="space-y-2">
        <TeamRow team={game.away} game={game} side="away" />
        <TeamRow team={game.home} game={game} side="home" />
      </div>
      <SituationStrip game={game} league={league} />
      {live && game.situation.lastPlay && <p className="line-clamp-2 text-[10px] leading-relaxed text-[#a2abad]">{game.situation.lastPlay}</p>}
      <WinBar game={game} />
      <LineCells game={game} league={league} />
      <p className="text-[9px] text-[#69757a]">{game.lines.source === "multi-book" ? `${live ? "Live" : "Best"} price across ${game.lines.books} books` : game.lines.source === "espn" ? (game.status === "pregame" ? "DraftKings line via ESPN" : "DraftKings closing line via ESPN") : ""}</p>
    </button>
  );
}
