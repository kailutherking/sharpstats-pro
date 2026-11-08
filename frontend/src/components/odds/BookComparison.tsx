import { Fragment, useMemo, useState } from "react";
import { Star } from "lucide-react";
import type { BookInfo, OddsGame, Selection, SportsbookRow } from "../../lib/oddsTypes";
import { american, bookShort, pct, priceLine, signedPct, startTime } from "../../lib/oddsFormat";
import { EmptyState, thClass } from "../stats/StatsUi";
import { LiveDot, MoveIndicator, SignalBadges } from "./OddsUi";

/**
 * Line shopping grid: one column per sportsbook, best price highlighted, highest-EV price ringed,
 * with movement since open and steam/sharp flags on each selection.
 */
export function BookComparison({ selections, games, books, sportsbooks, onToggleFavoriteBook, onHistory, onGame, title = "Sportsbook comparison", groupByGame = true }: {
  selections: Selection[];
  games: Map<string, OddsGame>;
  books: BookInfo[];
  sportsbooks?: SportsbookRow[];
  onToggleFavoriteBook?: (book: SportsbookRow) => void;
  onHistory: (selection: Selection) => void;
  onGame?: (gameId: string) => void;
  title?: string;
  groupByGame?: boolean;
}) {
  const [hideEmpty, setHideEmpty] = useState(true);
  const [limit, setLimit] = useState(40);
  const favorites = useMemo(() => new Set((sportsbooks ?? []).filter((book) => book.favorite).map((book) => book.key)), [sportsbooks]);
  const columns = useMemo(() => {
    const priced = new Set(selections.flatMap((selection) => selection.books.map((price) => price.book)));
    return books
      .filter((book) => !book.retired && (!hideEmpty || priced.has(book.key)))
      .sort((a, b) => Number(favorites.has(b.key)) - Number(favorites.has(a.key)) || Number(a.kind === "reference") - Number(b.kind === "reference"));
  }, [books, favorites, hideEmpty, selections]);

  const groups = useMemo(() => {
    const byGame = new Map<string, Selection[]>();
    for (const selection of selections) byGame.set(groupByGame ? selection.gameId : "all", [...(byGame.get(groupByGame ? selection.gameId : "all") ?? []), selection]);
    return [...byGame.entries()].sort((a, b) => (games.get(a[0])?.commenceTime ?? "").localeCompare(games.get(b[0])?.commenceTime ?? ""));
  }, [games, groupByGame, selections]);

  const visibleGroups = groups.slice(0, limit);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-[11px] text-muted"><span className="text-lime">Green</span> = best price · ringed = highest value vs fair odds · arrows show movement since open</p>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted">
          <input type="checkbox" checked={hideEmpty} onChange={(event) => setHideEmpty(event.target.checked)} className="accent-[#c5f467]" />
          Hide books without prices
        </label>
      </div>
      {sportsbooks && onToggleFavoriteBook && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-3 sm:px-5">
          <span className="mr-1 text-[10px] font-semibold tracking-wider text-[#738087]">FAVORITE SPORTSBOOKS</span>
          {sportsbooks.filter((book) => !book.retired && book.kind !== "reference" && book.id !== null).map((book) => (
            <button key={book.key} type="button" onClick={() => onToggleFavoriteBook(book)} aria-pressed={book.favorite}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] ${book.favorite ? "border-lime/60 bg-lime/10 text-lime" : "border-line text-muted hover:text-white"}`}>
              <Star size={10} className={book.favorite ? "fill-lime" : ""} />{book.name}
            </button>
          ))}
        </div>
      )}
      {!selections.length ? <EmptyState>No markets match these filters.</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: 520 + columns.length * 84 }}>
            <thead>
              <tr className={thClass}>
                <th className="sticky left-0 z-10 bg-panel px-4 py-3">SELECTION</th>
                {columns.map((book) => (
                  <th key={book.key} className="px-2 py-3 text-center" title={book.name}>
                    <span className={favorites.has(book.key) ? "text-lime" : ""}>{bookShort(book.key)}</span>
                    {book.kind === "dfs" && <span className="block text-[8px] font-normal text-sky-300">LINE</span>}
                    {book.kind === "reference" && <span className="block text-[8px] font-normal text-amber-300">SHARP</span>}
                  </th>
                ))}
                <th className="px-3 py-3 text-right">MKT AVG</th>
                <th className="px-3 py-3 text-right">FAIR</th>
                <th className="px-3 py-3 text-right">BEST</th>
                <th className="px-3 py-3 text-right" title="Fair probability minus the best price's implied probability">EDGE</th>
                <th className="px-4 py-3 text-right" title="Expected value of the best price vs the no-vig fair line">EV</th>
              </tr>
            </thead>
            <tbody>
              {visibleGroups.map(([gameId, items]) => {
                const game = games.get(gameId);
                const ordered = [...items].sort((a, b) => a.marketLabel.localeCompare(b.marketLabel) || a.pairId.localeCompare(b.pairId) || a.selection.localeCompare(b.selection));
                return (
                  <Fragment key={gameId}>
                    {groupByGame && (
                      <tr className="border-t border-line bg-[#0e1416]">
                        <td colSpan={columns.length + 6} className="px-4 py-2">
                          <button type="button" onClick={() => onGame?.(gameId)} className="flex items-center gap-2 text-left text-[11px] font-semibold text-white hover:text-lime">
                            {game?.label ?? gameId}<LiveDot live={game?.status === "live"} />
                            <span className="font-normal text-muted">{game ? startTime(game.commenceTime) : ""}</span>
                          </button>
                        </td>
                      </tr>
                    )}
                    {ordered.map((selection, index) => {
                      const topEv = selection.books.reduce<number | null>((best, price) => price.ev !== null && price.ev > 0 && (best === null || price.ev > best) ? price.ev : best, null);
                      const newPair = index > 0 && ordered[index - 1]!.pairId !== selection.pairId;
                      return (
                        <tr key={selection.id} className={`text-xs ${newPair ? "border-t border-line/70" : ""}`}>
                          <td className="sticky left-0 z-10 bg-panel px-4 py-2.5">
                            <button type="button" onClick={() => onHistory(selection)} className="block max-w-[260px] text-left">
                              <span className="block truncate font-medium text-white hover:text-lime">{selection.label}</span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted">{selection.marketLabel}<SignalBadges signals={selection.signals} /></span>
                            </button>
                          </td>
                          {columns.map((book) => {
                            const price = selection.books.find((item) => item.book === book.key);
                            if (!price) return <td key={book.key} className="px-2 py-2.5 text-center text-[#4d595e]">—</td>;
                            const highestValue = topEv !== null && price.ev === topEv;
                            return (
                              <td key={book.key} className="px-1.5 py-1.5 text-center">
                                <span title={`${book.name}${price.open ? ` · opened ${american(price.open.american)}` : ""}${price.ev !== null ? ` · EV ${pct(price.ev)}` : ""}`}
                                  className={`inline-flex min-w-[70px] flex-col items-center rounded-lg px-1.5 py-1 tabular-nums ${price.isBest ? "bg-lime/15 text-lime" : price.atLine ? "bg-[#0e1416] text-[#d9e0dc]" : "bg-[#0e1416] text-amber-200/80"} ${highestValue ? "ring-1 ring-lime" : ""}`}>
                                  {priceLine(selection, price) && <span className="text-[9px] text-muted">{priceLine(selection, price)}</span>}
                                  <span className="text-[11px] font-semibold">{book.kind === "dfs" && !price.priced ? (priceLine(selection, price) || american(price.american)) : american(price.american)}</span>
                                  <MoveIndicator value={price.probabilityMove} points={price.pointMove} />
                                </span>
                              </td>
                            );
                          })}
                          <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]">{american(selection.average?.american)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-[#d9e0dc]" title={selection.fair?.sourceLabel}>{american(selection.fair?.american)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-lime" title={selection.worst ? `Worst: ${american(selection.worst.american)} ${bookShort(selection.worst.book)}` : undefined}>{selection.best ? `${american(selection.best.american)} ${bookShort(selection.best.book)}` : "—"}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums ${selection.edge === null ? "text-muted" : selection.edge > 0 ? "text-lime" : "text-[#d9e0dc]"}`}>{signedPct(selection.edge)}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${selection.ev === null ? "text-muted" : selection.ev > 0 ? "text-lime" : "text-rose-400"}`}>{signedPct(selection.ev)}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {groups.length > limit && (
        <div className="border-t border-line p-3 text-center">
          <button type="button" onClick={() => setLimit((value) => value + 40)} className="text-[11px] font-semibold text-lime">Show more games ({groups.length - limit} remaining)</button>
        </div>
      )}
    </section>
  );
}
