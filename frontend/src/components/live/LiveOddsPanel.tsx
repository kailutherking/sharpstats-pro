import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { League } from "../../lib/statsTypes";
import type { BookQuote, DkLine, LiveGame, LiveOddsPanelData, MarketView } from "../../lib/liveTypes";
import { american, signedPoint } from "../../lib/oddsFormat";
import { formatUpdated } from "../../lib/statsFormat";
import { EmptyState, Panel } from "../stats/StatsUi";
import { Notice } from "../odds/OddsUi";
import { SPREAD_LABEL } from "./liveUi";

const price = (point: number | null | undefined, odds: number | null | undefined, total = false) =>
  `${point === null || point === undefined ? "" : total ? `${point} ` : `${signedPoint(point)} `}${american(odds)}`;

function Move({ quote, total }: { quote: BookQuote; total: boolean }) {
  if (quote.moveFromOpen === null || quote.moveFromOpen === 0) return null;
  const pointMove = quote.open && quote.point !== null && quote.open.point !== null && quote.point !== quote.open.point;
  const up = quote.moveFromOpen > 0;
  // For spreads a higher number is worse for the side; for moneyline a higher implied probability means the market likes it more.
  const good = pointMove ? (total ? up : !up) : up;
  return (
    <span className={`inline-flex items-center text-[9px] font-semibold ${good ? "text-lime" : "text-rose-400"}`}>
      {up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
      {pointMove ? `${Math.abs(quote.moveFromOpen)} pt` : `${Math.abs(quote.moveFromOpen * 100).toFixed(1)}%`}
    </span>
  );
}

function MarketTable({ market, label }: { market: MarketView; label: string }) {
  const total = market.key.includes("total");
  const books = [...new Set(market.sides.flatMap((side) => side.books.map((quote) => quote.book)))];
  const sides = market.sides.slice(0, 2);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs">
        <thead>
          <tr className="border-b border-line text-left text-[9px] font-semibold tracking-wider text-[#738087]">
            <th className="px-3 py-2">{label.toUpperCase()}</th>
            {sides.map((side) => <th key={side.selectionId} className="px-3 py-2">{side.selection.toUpperCase()} <span className="font-normal text-[#69757a]">· best {american(side.best?.american)}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {books.map((book) => (
            <tr key={book} className="border-b border-line/60 last:border-0">
              <td className="px-3 py-2 font-medium text-[#d9e0dc]">{sides[0]?.books.find((quote) => quote.book === book)?.name ?? sides[1]?.books.find((quote) => quote.book === book)?.name ?? book}</td>
              {sides.map((side) => {
                const quote = side.books.find((item) => item.book === book);
                if (!quote) return <td key={side.selectionId} className="px-3 py-2 text-muted">—</td>;
                const best = side.best?.book === book;
                return (
                  <td key={side.selectionId} className="px-3 py-2 align-top">
                    <span className={`font-semibold tabular-nums ${best ? "text-lime" : "text-white"}`}>{price(quote.point, quote.american, total)}</span> <Move quote={quote} total={total} />
                    <p className="mt-0.5 text-[10px] tabular-nums text-muted">
                      Open {quote.open ? price(quote.open.point, quote.open.american, total) : "—"}{quote.close ? ` · Close ${price(quote.close.point, quote.close.american, total)}` : ""}
                    </p>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EspnLines({ game, current, open, league }: { game: LiveGame; current: DkLine | null; open: DkLine | null; league: League }) {
  if (!current && !open) return <EmptyState>No lines posted for this game.</EmptyState>;
  const rows: Array<[string, string, string, string, string]> = [
    ["Moneyline", `${game.away.abbr} ${american(open?.moneyline?.away)} / ${game.home.abbr} ${american(open?.moneyline?.home)}`, `${game.away.abbr} ${american(current?.moneyline?.away)} / ${game.home.abbr} ${american(current?.moneyline?.home)}`, "", ""],
    [SPREAD_LABEL[league], `${game.home.abbr} ${price(open?.spread?.home.line, open?.spread?.home.odds)}`, `${game.home.abbr} ${price(current?.spread?.home.line, current?.spread?.home.odds)}`, "", ""],
    ["Total", `${price(open?.total?.line, open?.total?.over, true)} / ${american(open?.total?.under)}`, `${price(current?.total?.line, current?.total?.over, true)} / ${american(current?.total?.under)}`, "", ""],
  ];
  return (
    <table className="w-full text-xs">
      <thead><tr className="border-b border-line text-left text-[9px] font-semibold tracking-wider text-[#738087]"><th className="px-3 py-2">MARKET</th><th className="px-3 py-2">OPENING</th><th className="px-3 py-2">{game.status === "pregame" ? "CURRENT" : "LATEST"}</th></tr></thead>
      <tbody>{rows.map(([label, openText, currentText]) => <tr key={label} className="border-b border-line/60 last:border-0"><td className="px-3 py-2 text-[#d9e0dc]">{label}</td><td className="px-3 py-2 tabular-nums text-muted">{openText}</td><td className="px-3 py-2 font-semibold tabular-nums text-white">{currentText}</td></tr>)}</tbody>
    </table>
  );
}

const COVERAGE_STYLE = { priced: "border-[#34412a] text-lime", props_only: "border-sky-400/30 text-sky-300", no_prices: "border-line text-[#69757a]" } as const;
const COVERAGE_TEXT = { priced: "Priced", props_only: "Props only", no_prices: "No prices" } as const;

/** Current, opening and closing odds per sportsbook, line movement and book coverage for one game. */
export function LiveOddsPanel({ odds, game, league, onLoadMarkets, loadingMarkets }: { odds: LiveOddsPanelData; game: LiveGame; league: League; onLoadMarkets?: () => void; loadingMarkets?: boolean }) {
  const labels: Record<string, string> = { h2h: "Moneyline", spreads: SPREAD_LABEL[league], totals: "Total" };
  return (
    <Panel
      title="Live betting markets"
      subtitle={odds.source === "multi-book" ? `Sportsbook comparison · prices updated ${formatUpdated(odds.updatedAt ?? undefined)}${odds.closingCaptured ? " · closing = last pregame price" : ""}` : "DraftKings opening and latest lines via ESPN"}
      action={odds.oddsGameId && onLoadMarkets ? (
        <button type="button" onClick={onLoadMarkets} disabled={loadingMarkets} className="rounded-lg border border-line px-3 py-1.5 text-[11px] text-muted hover:text-white disabled:opacity-60">
          {loadingMarkets ? "Loading…" : odds.periodMarkets.length || odds.props ? "Refresh quarter markets & props" : "Load quarter markets & props"}
        </button>
      ) : undefined}
      flush
    >
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap gap-1.5">
          {odds.coverage.map((book) => <span key={book.key} title={book.status === "no_prices" ? "This book has no prices for this game from the odds provider" : undefined} className={`rounded-md border px-2 py-1 text-[10px] ${COVERAGE_STYLE[book.status]}`}>{book.name} · {COVERAGE_TEXT[book.status]}</span>)}
        </div>
        {odds.source === "multi-book" ? (
          <>
            {odds.markets.map((market) => <div key={market.key} className="rounded-xl border border-line bg-[#0e1416]"><MarketTable market={market} label={labels[market.key] ?? market.label} /></div>)}
            {odds.periodMarkets.length > 0 && (
              <details className="rounded-xl border border-line bg-[#0e1416]">
                <summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold text-[#d9e0dc]">Quarter, half and alternate markets ({odds.periodMarkets.length})</summary>
                <div className="space-y-3 border-t border-line p-2">{odds.periodMarkets.map((market) => <MarketTable key={market.key} market={market} label={market.label} />)}</div>
              </details>
            )}
            {odds.oddsGameId && !odds.periodMarkets.length && <p className="text-[10px] text-muted">Quarter/period markets and player props are loaded on request because each load uses The Odds API credits.</p>}
          </>
        ) : (
          <div className="rounded-xl border border-line bg-[#0e1416]"><EspnLines game={game} current={odds.espn.current} open={odds.espn.open} league={league} /></div>
        )}
        {odds.source === "espn" && <Notice>Multi-book prices for this game aren't loaded yet. They appear here on the Odds screen's next scheduled refresh.</Notice>}
      </div>
    </Panel>
  );
}
