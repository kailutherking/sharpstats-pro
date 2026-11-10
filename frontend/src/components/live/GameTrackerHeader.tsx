import { Clock3, RefreshCw } from "lucide-react";
import { formatUpdated } from "../../lib/statsFormat";
import { Segmented } from "../stats/StatsUi";

export type GameFilter = "all" | "live" | "pregame" | "final";

/** Tracker toolbar: game filter, counts, last update, auto-refresh status and manual refresh. */
export function GameTrackerHeader({ counts, filter, onFilter, fetchedAt, refreshSeconds, refreshing, onRefresh, oddsUpdatedAt }: {
  counts: { live: number; pregame: number; final: number } | undefined;
  filter: GameFilter;
  onFilter: (value: GameFilter) => void;
  fetchedAt: string | undefined;
  refreshSeconds: number;
  refreshing: boolean;
  onRefresh: () => void;
  oddsUpdatedAt: string | null | undefined;
}) {
  const total = counts ? counts.live + counts.pregame + counts.final : 0;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <Segmented<GameFilter>
        label="Game status"
        value={filter}
        onChange={onFilter}
        options={[
          { value: "all", label: `All${total ? ` (${total})` : ""}` },
          { value: "live", label: `Live${counts?.live ? ` (${counts.live})` : ""}` },
          { value: "pregame", label: `Upcoming${counts?.pregame ? ` (${counts.pregame})` : ""}` },
          { value: "final", label: `Final${counts?.final ? ` (${counts.final})` : ""}` },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[11px] text-muted" title={oddsUpdatedAt ? `Sportsbook prices updated ${formatUpdated(oddsUpdatedAt)}` : undefined}>
          <span className={`h-1.5 w-1.5 rounded-full ${counts?.live ? "animate-pulse bg-rose-400" : "bg-lime"}`} />Auto-refresh every {refreshSeconds}s
        </span>
        <span className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[11px] text-muted">
          <Clock3 size={13} className="text-lime" />Last updated: <span className="text-white">{fetchedAt ? new Date(fetchedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—"}</span>
        </span>
        <button type="button" onClick={onRefresh} disabled={refreshing} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs text-muted hover:text-white disabled:opacity-60">
          <RefreshCw size={14} className={refreshing ? "animate-spin text-lime" : ""} />Refresh
        </button>
      </div>
    </div>
  );
}
