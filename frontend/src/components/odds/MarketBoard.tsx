import { useMemo, useState } from "react";
import { LineChart, Plus } from "lucide-react";
import type { BookInfo, BookPrice, OddsGame, Selection, Sizing } from "../../lib/oddsTypes";
import { american, lineMoveText, pct, priceLine, recommendedStake, money, signedPct, startTime, timeAgo } from "../../lib/oddsFormat";
import { EmptyState, Segmented, SortHeader, thClass } from "../stats/StatsUi";
import { BookTag, LiveDot, MoveIndicator, SignalBadges, TierBadge, numClass, tdClass } from "./OddsUi";

export interface BoardRow { selection: Selection; price: BookPrice; game: OddsGame | undefined }
type SortKey = "start" | "ev" | "arb" | "move" | "kelly" | "updated" | "market";
const PAGE = 60;

export function boardRows(selections: Selection[], games: Map<string, OddsGame>, mode: "best" | "all", book: string): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const selection of selections) {
    const game = games.get(selection.gameId);
    const prices = book
      ? selection.books.filter((price) => price.book === book)
      : mode === "all" ? selection.books : [selection.books.find((price) => price.isBest) ?? selection.books[0]].filter((price): price is BookPrice => Boolean(price));
    for (const price of prices) rows.push({ selection, price, game });
  }
  return rows;
}

function sortRows(rows: BoardRow[], key: SortKey, direction: "asc" | "desc"): BoardRow[] {
  const value = (row: BoardRow): number | string => {
    switch (key) {
      case "start": return row.game?.commenceTime ?? "";
      case "ev": return row.price.ev ?? -1;
      case "arb": return row.selection.arbitrage ?? -1;
      case "move": return Math.abs(row.price.probabilityMove ?? 0);
      case "kelly": return row.price.kelly ?? -1;
      case "updated": return row.price.lastChangeAt ?? row.price.lastSeenAt;
      case "market": return `${row.selection.marketLabel}|${row.selection.label}`;
    }
  };
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return order * sign || (a.game?.commenceTime ?? "").localeCompare(b.game?.commenceTime ?? "") || a.selection.id.localeCompare(b.selection.id);
  });
}

export function MarketBoard({ selections, games, books, sizing, bookFilter, onHistory, onTrack, onGame }: {
  selections: Selection[];
  games: Map<string, OddsGame>;
  books: BookInfo[];
  sizing: Sizing | undefined;
  bookFilter: string;
  onHistory: (selection: Selection) => void;
  onTrack: (selection: Selection, price: BookPrice) => void;
  onGame: (gameId: string) => void;
}) {
  const [mode, setMode] = useState<"best" | "all">("best");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "start", direction: "asc" });
  const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => sortRows(boardRows(selections, games, mode, bookFilter), sort.key, sort.direction), [bookFilter, games, mode, selections, sort]);
  const header = (key: SortKey, label: string, title?: string, align: "left" | "right" = "right") => (
    <SortHeader key={key} label={label} title={title} align={align} active={sort.key === key} direction={sort.direction}
      onClick={() => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "start" || key === "market" ? "asc" : "desc" })} />
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div>
          <p className="text-sm font-semibold">Market board</p>
          <p className="mt-1 text-[11px] text-muted">{rows.length.toLocaleString()} prices · implied, no-vig model, EV and Kelly for every number</p>
        </div>
        <Segmented label="Board rows" value={mode} onChange={(next) => { setMode(next); setLimit(PAGE); }} options={[{ value: "best", label: "Best price per selection" }, { value: "all", label: "Every sportsbook" }]} />
      </div>
      {!rows.length ? <EmptyState>No prices match these filters.</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1580px] text-left">
            <thead>
              <tr className={thClass}>
                <th className="px-4 py-3">GAME</th>
                {header("start", "START", "Start time", "left")}
                {header("market", "MARKET", undefined, "left")}
                <th className="px-3 py-3">SELECTION</th>
                <th className="px-3 py-3">SPORTSBOOK</th>
                <th className="px-3 py-3 text-right">CURRENT</th>
                <th className="px-3 py-3 text-right">OPENING</th>
                {header("move", "LINE MOVE", "Move since the opening number")}
                <th className="px-3 py-3 text-right">BEST</th>
                <th className="px-3 py-3 text-right">MKT AVG</th>
                <th className="px-3 py-3 text-right" title="Implied probability of this price">IMPLIED</th>
                <th className="px-3 py-3 text-right" title="No-vig fair probability (sharp reference or consensus)">MODEL</th>
                {header("ev", "EV %")}
                {header("arb", "ARB %", "Arbitrage profit when combined with the best opposing price")}
                {header("kelly", "KELLY %", "Fractional Kelly stake as a share of bankroll")}
                <th className="px-3 py-3 text-right">STAKE</th>
                {header("updated", "UPDATED")}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map(({ selection, price, game }) => {
                const kellyShare = price.kelly && sizing ? Math.min(sizing.maxStakeFraction, price.kelly * sizing.kellyMultiplier) : null;
                const stake = recommendedStake(price.kelly, sizing);
                return (
                  <tr key={`${selection.id}|${price.book}`} className="border-t border-line text-xs hover:bg-white/[0.015]">
                    <td className="px-4 py-3 align-middle">
                      <button type="button" onClick={() => onGame(selection.gameId)} className="block max-w-[200px] truncate text-left font-medium text-white hover:text-lime" title={game?.label}>{game?.label ?? selection.gameId}</button>
                      <span className="mt-1 flex items-center gap-1.5"><LiveDot live={game?.status === "live"} /></span>
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-[#d9e0dc]`}>{game ? startTime(game.commenceTime) : "—"}</td>
                    <td className={`${tdClass} whitespace-nowrap text-muted`}>{selection.marketLabel}</td>
                    <td className={tdClass}>
                      <span className="flex flex-wrap items-center gap-1.5"><span className="font-medium text-white">{selection.label}</span><TierBadge tier={price.ev !== null && price.ev >= 0.005 ? (price.ev >= 0.06 ? "elite" : price.ev >= 0.03 ? "strong" : "positive") : null} /><SignalBadges signals={selection.signals} /></span>
                      {!price.atLine && <span className="mt-0.5 block text-[10px] text-amber-300">Different number: {priceLine(selection, price)}</span>}
                    </td>
                    <td className={tdClass}><BookTag book={price.book} books={books} /></td>
                    <td className={`${numClass} font-semibold ${price.isBest ? "text-lime" : "text-white"}`}>
                      {priceLine(selection, price) && <span className="mr-1 text-[10px] font-normal text-muted">{priceLine(selection, price)}</span>}{american(price.american)}
                    </td>
                    <td className={`${numClass} text-[#d9e0dc]`}>{price.open ? <>{price.open.point !== null && <span className="mr-1 text-[10px] text-muted">{priceLine(selection, { point: price.open.point })}</span>}{american(price.open.american)}</> : "—"}</td>
                    <td className={numClass}><span className="flex flex-col items-end gap-0.5"><span className="whitespace-nowrap text-[10px] text-muted">{lineMoveText(selection, price)}</span><MoveIndicator value={price.probabilityMove} points={price.pointMove} /></span></td>
                    <td className={`${numClass} text-lime`}>{selection.best ? <span title={books.find((book) => book.key === selection.best!.book)?.name}>{american(selection.best.american)}</span> : "—"}</td>
                    <td className={`${numClass} text-[#d9e0dc]`}>{american(selection.average?.american)}</td>
                    <td className={`${numClass} text-[#d9e0dc]`}>{pct(price.implied)}</td>
                    <td className={`${numClass} text-[#d9e0dc]`} title={selection.fair?.sourceLabel}>{selection.fair ? pct(selection.fair.probability) : "—"}</td>
                    <td className={`${numClass} font-semibold ${price.ev === null ? "text-muted" : price.ev > 0 ? "text-lime" : "text-rose-400"}`}>{signedPct(price.ev)}</td>
                    <td className={`${numClass} ${selection.arbitrage !== null ? "font-semibold text-amber-300" : "text-muted"}`}>{selection.arbitrage !== null ? pct(selection.arbitrage, 2) : "—"}</td>
                    <td className={`${numClass} text-[#d9e0dc]`}>{kellyShare ? pct(kellyShare, 2) : "—"}</td>
                    <td className={`${numClass} text-white`}>{stake ? money(stake) : "—"}</td>
                    <td className={`${numClass} whitespace-nowrap text-muted`} title={price.lastChangeAt ? `Price changed ${new Date(price.lastChangeAt).toLocaleString()}` : `Seen ${new Date(price.lastSeenAt).toLocaleString()}`}>{timeAgo(price.lastChangeAt ?? price.lastSeenAt)}</td>
                    <td className="px-4 py-3 text-right align-middle">
                      <span className="inline-flex gap-1">
                        <button type="button" onClick={() => onHistory(selection)} aria-label={`Line history for ${selection.label}`} title="Line movement & odds history" className="rounded-md border border-line p-1.5 text-muted hover:border-lime hover:text-lime"><LineChart size={12} /></button>
                        <button type="button" onClick={() => onTrack(selection, price)} aria-label={`Track ${selection.label} at ${price.book}`} title="Log this bet" className="rounded-md border border-line p-1.5 text-muted hover:border-lime hover:text-lime"><Plus size={12} /></button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > limit && (
        <div className="border-t border-line p-3 text-center">
          <button type="button" onClick={() => setLimit((value) => value + PAGE * 2)} className="text-[11px] font-semibold text-lime">Show more ({(rows.length - limit).toLocaleString()} remaining)</button>
        </div>
      )}
      <p className="border-t border-line px-5 py-3 text-[10px] text-muted">Model probability is the no-vig fair price. Stakes use fractional Kelly{sizing ? ` (${sizing.kellyMultiplier}×)` : ""} capped at {sizing ? pct(sizing.maxStakeFraction, 0) : "5%"} of your bankroll. Verify every price at the sportsbook before betting.</p>
    </section>
  );
}
