import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "../../lib/api";
import type { BookInfo, MarketCategory, OddsGame, OddsSport, Selection } from "../../lib/oddsTypes";
import { startTime } from "../../lib/oddsFormat";
import { LoadingBlock, Segmented } from "../stats/StatsUi";
import { BookComparison } from "./BookComparison";
import { LiveDot, Notice } from "./OddsUi";

const GROUPS: Array<{ value: MarketCategory | "all"; label: string }> = [
  { value: "all", label: "All" }, { value: "game", label: "Game" }, { value: "period", label: "Periods" }, { value: "team", label: "Team totals" },
  { value: "alternate", label: "Alternates" }, { value: "prop", label: "Player props" },
];

/** Every market for one game: full game, halves/quarters/periods, team totals, alternates and props. */
export function GameDrawer({ sport, gameId, books, keyless, onClose, onHistory }: { sport: OddsSport; gameId: string; books: BookInfo[]; keyless: boolean; onClose: () => void; onHistory: (selection: Selection) => void }) {
  const [group, setGroup] = useState<MarketCategory | "all">("all");
  const detail = useQuery({
    queryKey: ["odds-game", sport, gameId, group === "prop"],
    queryFn: () => api.oddsGame(sport, gameId, group === "prop"),
    refetchInterval: 60_000,
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const data = detail.data;
  const selections = useMemo(() => (data?.markets ?? []).filter((market) => group === "all" || market.category === group).flatMap((market) => market.selections), [data, group]);
  const games = useMemo(() => new Map<string, OddsGame>(data ? [[data.game.id, data.game]] : []), [data]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label="Game markets" onClick={onClose}>
      <div className="h-full w-full max-w-[1100px] overflow-y-auto border-l border-line bg-canvas p-4 sm:p-6" onClick={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-[10px] font-bold tracking-[0.17em] text-lime">ALL MARKETS</p>
            <h3 className="flex items-center gap-2 font-display text-lg font-bold">{data?.game.label ?? "Loading game…"}<LiveDot live={data?.game.status === "live"} /></h3>
            {data && <p className="mt-1 text-[11px] text-muted">{startTime(data.game.commenceTime)} · {data.markets.length} markets · {selections.length} selections</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border border-line p-2 text-muted hover:text-white"><X size={15} /></button>
        </div>
        <div className="mb-4"><Segmented label="Market group" value={group} onChange={setGroup} options={GROUPS} /></div>
        {keyless && group !== "game" && group !== "all" && <div className="mb-4"><Notice tone="warn">Halves, quarters, periods, team totals, alternate lines and player props require ODDS_API_KEY. ESPN's keyless feed publishes full-game lines only.</Notice></div>}
        {detail.isLoading ? <LoadingBlock label="Loading every market for this game…" /> : detail.error ? <Notice tone="error">{detail.error instanceof Error ? detail.error.message : "Could not load this game."}</Notice> : (
          <BookComparison title="Markets" selections={selections} games={games} books={data?.books ?? books} onHistory={onHistory} groupByGame={false} />
        )}
      </div>
    </div>
  );
}
