import type { LeaderBoard, LeaderEntry } from "../../lib/statsTypes";
import { formatStat } from "../../lib/statsFormat";
import { Avatar, EmptyState } from "./StatsUi";

export function LeagueLeaders({ boards, groupLabels, filter, onPlayer, showSample }: {
  boards: LeaderBoard[];
  groupLabels: Record<string, string>;
  filter: (entry: LeaderEntry) => boolean;
  onPlayer: (id: string) => void;
  showSample: boolean;
}) {
  if (!boards.length) return <EmptyState>No league leaders are available yet.</EmptyState>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {boards.map((board) => {
        const entries = board.leaders.filter(filter).slice(0, 5);
        const [top, ...rest] = entries;
        return (
          <article key={`${board.group}-${board.key}`} className="flex flex-col rounded-2xl border border-line bg-panel p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold tracking-[0.14em] text-lime">{board.short}</p>
                <p className="mt-1 text-xs font-semibold text-white">{board.label}</p>
              </div>
              {Object.keys(groupLabels).length > 1 && <span className="rounded bg-[#20292e] px-1.5 py-0.5 text-[9px] text-muted">{groupLabels[board.group]}</span>}
            </div>
            {top ? (
              <>
                <button type="button" onClick={() => onPlayer(top.id)} className="mt-4 flex items-center gap-3 rounded-xl border border-[#34412a] bg-[#182017] p-3 text-left transition hover:border-lime/60">
                  <Avatar src={top.headshot} name={top.name} size={42} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">{top.name}</span>
                    <span className="block text-[10px] text-muted">{top.teamAbbr} · {top.position}{showSample && top.sample !== undefined ? ` · ${top.sample} G` : ""}</span>
                  </span>
                  <span className="font-display text-xl font-extrabold text-lime">{formatStat(top.value, board.format)}</span>
                </button>
                <ol className="mt-2 space-y-0.5">
                  {rest.map((entry, index) => (
                    <li key={entry.id}>
                      <button type="button" onClick={() => onPlayer(entry.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/[0.04]">
                        <span className="w-4 text-[10px] text-muted">{index + 2}</span>
                        <Avatar src={entry.headshot} name={entry.name} size={22} />
                        <span className="min-w-0 flex-1 truncate text-[#d9e0dc]">{entry.shortName}<span className="ml-1.5 text-[10px] text-muted">{entry.teamAbbr}</span></span>
                        <span className="font-semibold text-white">{formatStat(entry.value, board.format)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            ) : <p className="mt-6 text-center text-xs text-muted">No leaders match these filters.</p>}
          </article>
        );
      })}
    </div>
  );
}
