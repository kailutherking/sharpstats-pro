import { bookByKey, isPricedBook, marketDef, type MarketDef, type OddsSport } from "./oddsCatalog";
import {
  americanToDecimal, average, confidenceRating, evTier, expectedValue, kellyFraction, probabilityToAmerican, removeVig, riskRating,
  type Confidence, type EvTier, type RiskRating,
} from "./evCalculator.service";
import type { OddsGame, RawQuote } from "./oddsTypes";

/** Tracked history for one price (one book, one side), maintained by lineMovement.service. */
export interface LineState {
  openAmerican: number;
  openPoint: number | null;
  openAt: string;
  prevAmerican: number | null;
  prevPoint: number | null;
  highAmerican: number;
  lowAmerican: number;
  highPoint: number | null;
  lowPoint: number | null;
  lastChangeAt: string | null;
  lastSeenAt: string;
}

export interface SideSignals {
  steam: boolean;
  sharp: boolean;
  /**
   * Estimated reverse line movement: the line moved toward the side the public usually avoids
   * (underdog or under). Ticket splits are not published by the providers, so this is a proxy.
   */
  reverse: boolean;
  moves: number;
  lastMoveAt: string | null;
}

export interface BookPrice {
  book: string;
  american: number;
  decimal: number;
  point: number | null;
  implied: number;
  /** False when this book hangs a different number from the market's main line. */
  atLine: boolean;
  priced: boolean;
  bookUpdatedAt: string | null;
  lastSeenAt: string;
  open: { american: number; point: number | null; at: string } | null;
  previous: { american: number; point: number | null } | null;
  high: number | null;
  low: number | null;
  highPoint: number | null;
  lowPoint: number | null;
  lastChangeAt: string | null;
  /** Change in implied probability since the open (positive = the market moved toward this side). */
  probabilityMove: number | null;
  pointMove: number | null;
  isBest: boolean;
  ev: number | null;
  kelly: number | null;
}

export interface FairValue {
  probability: number;
  american: number | null;
  source: "sharp" | "consensus";
  sourceLabel: string;
  books: number;
}

export interface Selection {
  id: string;
  pairId: string;
  gameId: string;
  sport: OddsSport;
  market: string;
  marketLabel: string;
  category: MarketDef["category"];
  type: MarketDef["type"];
  period: MarketDef["period"];
  selection: string;
  participant: string;
  point: number | null;
  label: string;
  books: BookPrice[];
  best: { book: string; american: number; decimal: number } | null;
  /** Lowest comparable price on this side, for line-shopping spread. */
  worst: { book: string; american: number; decimal: number } | null;
  average: { american: number | null; implied: number } | null;
  fair: FairValue | null;
  ev: number | null;
  edge: number | null;
  kelly: number | null;
  tier: EvTier | null;
  risk: RiskRating | null;
  confidence: Confidence | null;
  arbitrage: number | null;
  signals: SideSignals;
  updatedAt: string;
}

export interface ArbitrageLeg {
  selectionId: string;
  label: string;
  book: string;
  american: number;
  decimal: number;
  stakeShare: number;
  updatedAt: string;
}

export interface ArbitrageOpportunity {
  id: string;
  gameId: string;
  sport: OddsSport;
  market: string;
  marketLabel: string;
  participant: string;
  profitPct: number;
  guaranteedReturn: number;
  legs: ArbitrageLeg[];
  books: string[];
  rating: "strong" | "solid" | "thin";
  oldestLegAt: string;
}

export interface AggregateInput {
  games: Map<string, OddsGame>;
  quotes: RawQuote[];
  lineStates: Map<string, LineState>;
  signals: (sideId: string) => SideSignals;
  sharpBook: string | null;
  now?: number;
}

const NO_SIGNALS: SideSignals = { steam: false, sharp: false, reverse: false, moves: 0, lastMoveAt: null };

/** One point of spread/total is worth roughly three points of win probability in the major US sports. */
const POINT_WEIGHT = 0.03;
/** Minimum average move toward a side to call it reverse movement: 2.5% implied, or about one point of spread/total. */
export const RLM_MIN_MOVE = 0.025;

/** Market move toward one side since the open, averaged over books with history: price plus point change. */
export function sideMarketMove(selection: Pick<Selection, "type" | "selection" | "books">): { move: number; books: number; toward: number } | null {
  const moves = selection.books
    .filter((price) => price.priced && price.atLine && price.open && price.probabilityMove !== null)
    .map((price) => {
      let pointEffect = 0;
      if (price.open!.point !== null && price.point !== null) {
        if (selection.type === "spread") pointEffect = price.open!.point - price.point;
        else if (/^over$/i.test(selection.selection)) pointEffect = price.point - price.open!.point;
        else if (/^under$/i.test(selection.selection)) pointEffect = price.open!.point - price.point;
      }
      return price.probabilityMove! + pointEffect * POINT_WEIGHT;
    });
  if (!moves.length) return null;
  return { move: moves.reduce((sum, value) => sum + value, 0) / moves.length, books: moves.length, toward: moves.filter((value) => value > 0).length };
}

/**
 * Which side of a two-way game market shows estimated reverse line movement. The public side is
 * taken as the favorite (moneyline/spread) or the over (totals), the well-documented recreational
 * bias; a meaningful move toward the other side, backed by most books with history, is flagged.
 */
export function reverseLineSide(sides: Array<Pick<Selection, "id" | "type" | "category" | "selection" | "point" | "books">>): string | null {
  if (sides.length !== 2) return null;
  const [a, b] = sides as [typeof sides[0], typeof sides[0]];
  if (a.category !== "game" && a.category !== "period") return null;
  let unpopular: typeof a | undefined;
  if (a.type === "total") unpopular = sides.find((side) => /^under$/i.test(side.selection));
  else if (a.type === "spread") {
    const openPoint = (side: typeof a) => side.books.find((price) => price.atLine && price.open?.point != null)?.open?.point ?? side.point;
    const pa = openPoint(a);
    const pb = openPoint(b);
    if (pa !== null && pb !== null && pa !== pb) unpopular = pa > pb ? a : b;
  } else if (a.type === "moneyline") {
    const openImplied = (side: typeof a) => average(side.books.filter((price) => price.priced && price.open).map((price) => 1 / americanToDecimal(price.open!.american)));
    const ia = openImplied(a);
    const ib = openImplied(b);
    if (ia !== null && ib !== null && Math.abs(ia - ib) > 0.02) unpopular = ia < ib ? a : b;
  }
  if (!unpopular) return null;
  const move = sideMarketMove(unpopular);
  if (!move || move.move < RLM_MIN_MOVE) return null;
  return move.toward >= Math.min(2, move.books) && move.toward * 2 > move.books ? unpopular.id : null;
}

export function signedPoint(point: number): string {
  if (point === 0) return "PK";
  return point > 0 ? `+${point}` : String(point);
}

export function lineIdentity(quote: Pick<RawQuote, "gameId" | "market" | "participant" | "selection" | "point">, category: MarketDef["category"] | undefined): string {
  const base = `${quote.gameId}|${quote.market}|${quote.participant}|${quote.selection}`;
  return category === "alternate" ? `${base}|${quote.point ?? ""}` : base;
}

export function lineId(quote: RawQuote, category: MarketDef["category"] | undefined): string {
  return `${lineIdentity(quote, category)}|${quote.book}`;
}

/** The line from a common perspective so both sides of a market can be paired: home team for spreads. */
function pairPoint(quote: RawQuote, game: OddsGame | undefined, type: MarketDef["type"]): number | null {
  if (quote.point === null) return null;
  if (type === "spread") return quote.selection === game?.homeTeam ? quote.point : -quote.point;
  return quote.point;
}

function sidePoint(pair: number | null, selection: string, game: OddsGame | undefined, type: MarketDef["type"]): number | null {
  if (pair === null) return null;
  if (type === "spread") return selection === game?.homeTeam ? pair : -pair;
  return pair;
}

function selectionLabel(def: MarketDef, selection: string, participant: string, point: number | null): string {
  switch (def.type) {
    case "moneyline": return selection;
    case "spread": return point === null ? selection : `${selection} ${signedPoint(point)}`;
    case "total": return point === null ? selection : `${selection} ${point}`;
    case "team_total":
    case "prop_ou": return `${participant ? `${participant} ` : ""}${selection}${point === null ? "" : ` ${point}`}`;
    case "prop_yes": return participant ? `${participant} · ${selection}` : selection;
    default: return selection;
  }
}

function modal(values: Array<number | null>): number | null {
  const counts = new Map<string, { value: number | null; count: number }>();
  for (const value of values) {
    const key = String(value);
    const entry = counts.get(key) ?? { value, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  let best: { value: number | null; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count || (entry.count === best.count && Math.abs(entry.value ?? 0) < Math.abs(best.value ?? 0))) best = entry;
  }
  return best?.value ?? null;
}

function fallbackDef(market: string): MarketDef {
  return { key: market, label: market.replace(/_/g, " "), short: market.toUpperCase(), category: market.startsWith("player_") || market.startsWith("batter_") || market.startsWith("pitcher_") ? "prop" : "game", type: "prop_ou", period: "game" };
}

/**
 * Turns raw quotes into comparable selections: groups both sides of each market, finds the main
 * line, the best and average price, a no-vig fair probability (sharp reference book when it hangs
 * the main line, otherwise the consensus of every priced book), EV/Kelly per price and arbitrage.
 */
export function aggregate(input: AggregateInput): { selections: Selection[]; arbitrage: ArbitrageOpportunity[] } {
  const now = input.now ?? Date.now();
  const pairs = new Map<string, { def: MarketDef; game: OddsGame | undefined; quotes: RawQuote[] }>();
  for (const quote of input.quotes) {
    const game = input.games.get(quote.gameId);
    const def = marketDef(quote.sport, quote.market) ?? fallbackDef(quote.market);
    const pp = pairPoint(quote, game, def.type);
    const pairKey = `${quote.gameId}|${quote.market}|${quote.participant}${def.category === "alternate" ? `|${pp ?? ""}` : ""}`;
    const entry = pairs.get(pairKey) ?? { def, game, quotes: [] };
    entry.quotes.push(quote);
    pairs.set(pairKey, entry);
  }

  const selections: Selection[] = [];
  const arbitrage: ArbitrageOpportunity[] = [];

  for (const [pairId, { def, game, quotes }] of pairs) {
    const priced = quotes.filter((quote) => isPricedBook(quote.book));
    const mainLine = modal((priced.length ? priced : quotes).map((quote) => pairPoint(quote, game, def.type)));
    const atLine = (quote: RawQuote) => pairPoint(quote, game, def.type) === mainLine;
    const sides = [...new Set(quotes.map((quote) => quote.selection))];

    // No-vig per book that prices every side at the main line.
    const byBook = new Map<string, Map<string, RawQuote>>();
    for (const quote of priced) {
      if (!atLine(quote)) continue;
      const book = byBook.get(quote.book) ?? new Map<string, RawQuote>();
      const existing = book.get(quote.selection);
      if (!existing || quote.decimal > existing.decimal) book.set(quote.selection, quote);
      byBook.set(quote.book, book);
    }
    const fairBySide = new Map<string, number[]>();
    let sharpFair: Map<string, number> | null = null;
    if (sides.length >= 2) {
      for (const [book, sideQuotes] of byBook) {
        if (sideQuotes.size !== sides.length) continue;
        const ordered = sides.map((side) => sideQuotes.get(side)!);
        const fair = removeVig(ordered.map((quote) => quote.decimal));
        if (!fair) continue;
        if (book === input.sharpBook) sharpFair = new Map(sides.map((side, index) => [side, fair[index]!]));
        else sides.forEach((side, index) => fairBySide.set(side, [...(fairBySide.get(side) ?? []), fair[index]!]));
      }
    }
    const consensusBooks = Math.max(0, ...[...fairBySide.values()].map((values) => values.length));
    const sharpName = input.sharpBook ? bookByKey(input.sharpBook)?.name ?? input.sharpBook : "";

    const sideSelections: Selection[] = [];
    for (const side of sides) {
      const sideQuotes = quotes.filter((quote) => quote.selection === side);
      const participant = sideQuotes[0]!.participant;
      const point = sidePoint(mainLine, side, game, def.type);
      const id = lineIdentity({ gameId: sideQuotes[0]!.gameId, market: def.key, participant, selection: side, point }, def.category);
      const consensus = average(fairBySide.get(side) ?? []);
      const fair: FairValue | null = sharpFair?.has(side)
        ? { probability: sharpFair.get(side)!, american: probabilityToAmerican(sharpFair.get(side)!), source: "sharp", sourceLabel: `${sharpName} no-vig`, books: 1 + consensusBooks }
        : consensus !== null
          ? { probability: consensus, american: probabilityToAmerican(consensus), source: "consensus", sourceLabel: `Consensus no-vig · ${consensusBooks} book${consensusBooks === 1 ? "" : "s"}`, books: consensusBooks }
          : null;
      const trusted = fair !== null && (fair.source === "sharp" || fair.books >= 2);

      const books: BookPrice[] = sideQuotes
        .filter((quote) => bookByKey(quote.book)?.kind !== "reference" || quote.book === input.sharpBook)
        .map((quote) => {
          const state = input.lineStates.get(lineId(quote, def.category));
          const pricedBook = isPricedBook(quote.book);
          const open = state ? { american: state.openAmerican, point: state.openPoint, at: state.openAt } : null;
          const openImplied = open ? 1 / americanToDecimal(open.american) : null;
          const ev = trusted && pricedBook && atLine(quote) ? expectedValue(fair!.probability, quote.decimal) : null;
          return {
            book: quote.book,
            american: quote.american,
            decimal: quote.decimal,
            point: quote.point,
            implied: 1 / quote.decimal,
            atLine: atLine(quote),
            priced: pricedBook,
            bookUpdatedAt: quote.bookUpdatedAt,
            lastSeenAt: state?.lastSeenAt ?? new Date(now).toISOString(),
            open,
            previous: state && state.prevAmerican !== null ? { american: state.prevAmerican, point: state.prevPoint } : null,
            high: state?.highAmerican ?? null,
            low: state?.lowAmerican ?? null,
            highPoint: state?.highPoint ?? null,
            lowPoint: state?.lowPoint ?? null,
            lastChangeAt: state?.lastChangeAt ?? null,
            probabilityMove: openImplied === null ? null : 1 / quote.decimal - openImplied,
            pointMove: open && open.point !== null && quote.point !== null ? quote.point - open.point : null,
            isBest: false,
            ev,
            kelly: ev !== null ? kellyFraction(fair!.probability, quote.decimal) : null,
          };
        })
        .sort((a, b) => Number(b.atLine) - Number(a.atLine) || b.decimal - a.decimal);

      const comparable = books.filter((price) => price.priced && price.atLine && bookByKey(price.book)?.kind !== "reference");
      const bestPrice = comparable.reduce<BookPrice | null>((best, price) => !best || price.decimal > best.decimal ? price : best, null);
      const worstPrice = comparable.length > 1 ? comparable.reduce<BookPrice | null>((worst, price) => !worst || price.decimal < worst.decimal ? price : worst, null) : null;
      if (bestPrice) for (const price of comparable) price.isBest = price.decimal === bestPrice.decimal;
      const averageImplied = average(comparable.map((price) => price.implied));
      const bestEv = bestPrice?.ev ?? null;
      const latest = sideQuotes.reduce((latestAt, quote) => {
        const seen = input.lineStates.get(lineId(quote, def.category))?.lastSeenAt;
        return seen && seen > latestAt ? seen : latestAt;
      }, "");
      sideSelections.push({
        id,
        pairId,
        gameId: sideQuotes[0]!.gameId,
        sport: sideQuotes[0]!.sport,
        market: def.key,
        marketLabel: def.label,
        category: def.category,
        type: def.type,
        period: def.period,
        selection: side,
        participant,
        point,
        label: selectionLabel(def, side, participant, point),
        books,
        best: bestPrice ? { book: bestPrice.book, american: bestPrice.american, decimal: bestPrice.decimal } : null,
        worst: worstPrice ? { book: worstPrice.book, american: worstPrice.american, decimal: worstPrice.decimal } : null,
        average: averageImplied === null ? null : { american: probabilityToAmerican(averageImplied), implied: averageImplied },
        fair,
        ev: bestEv,
        edge: trusted && bestPrice ? fair!.probability - bestPrice.implied : null,
        kelly: bestPrice?.kelly ?? null,
        tier: evTier(bestEv),
        risk: bestEv !== null && bestPrice
          ? riskRating({ ev: bestEv, decimal: bestPrice.decimal, fairBooks: fair!.books, isProp: def.category === "prop", sharpReference: fair!.source === "sharp" })
          : null,
        confidence: bestEv !== null && bestPrice
          ? confidenceRating({
            ev: bestEv, decimal: bestPrice.decimal, fairBooks: fair!.books, sharpReference: fair!.source === "sharp",
            isProp: def.category === "prop", booksAtLine: comparable.length,
            priceAgeSeconds: bestPrice.bookUpdatedAt ? Math.max(0, (now - Date.parse(bestPrice.bookUpdatedAt)) / 1000) : null,
            steam: input.signals(id)?.steam,
          })
          : null,
        arbitrage: null,
        signals: { ...NO_SIGNALS, ...(input.signals(id) ?? {}) },
        updatedAt: latest || new Date(now).toISOString(),
      });
    }

    const reverseId = reverseLineSide(sideSelections);
    if (reverseId) for (const selection of sideSelections) if (selection.id === reverseId) selection.signals = { ...selection.signals, reverse: true };

    // Arbitrage: the best price on every side at the main line, across different priced books.
    if (sides.length >= 2 && sideSelections.every((selection) => selection.best)) {
      const legs = sideSelections.map((selection) => ({ selection, best: selection.best! }));
      const totalImplied = legs.reduce((sum, leg) => sum + 1 / leg.best.decimal, 0);
      if (totalImplied < 1 && new Set(legs.map((leg) => leg.best.book)).size > 1) {
        const profitPct = 1 / totalImplied - 1;
        for (const selection of sideSelections) selection.arbitrage = profitPct;
        const legUpdates = legs.map((leg) => leg.selection.books.find((price) => price.book === leg.best.book)?.lastChangeAt
          ?? leg.selection.books.find((price) => price.book === leg.best.book)?.lastSeenAt ?? new Date(now).toISOString());
        arbitrage.push({
          id: `${pairId}|${mainLine ?? ""}`,
          gameId: sideSelections[0]!.gameId,
          sport: sideSelections[0]!.sport,
          market: def.key,
          marketLabel: def.label,
          participant: sideSelections[0]!.participant,
          profitPct,
          guaranteedReturn: 100 / totalImplied,
          legs: legs.map((leg, index) => ({
            selectionId: leg.selection.id,
            label: leg.selection.label,
            book: leg.best.book,
            american: leg.best.american,
            decimal: leg.best.decimal,
            stakeShare: (1 / leg.best.decimal) / totalImplied,
            updatedAt: legUpdates[index]!,
          })),
          books: [...new Set(legs.map((leg) => leg.best.book))],
          rating: profitPct >= 0.03 ? "strong" : profitPct >= 0.01 ? "solid" : "thin",
          oldestLegAt: legUpdates.reduce((oldest, value) => value < oldest ? value : oldest),
        });
      }
    }
    selections.push(...sideSelections);
  }
  arbitrage.sort((a, b) => b.profitPct - a.profitPct);
  return { selections, arbitrage };
}
