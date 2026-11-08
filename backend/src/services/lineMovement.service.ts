import { pool } from "../db/pool";
import { americanToDecimal } from "./evCalculator.service";
import { lineId, lineIdentity, type LineState, type Selection, type SideSignals } from "./oddsAggregator.service";
import { marketDef, type OddsSport } from "./oddsCatalog";
import type { RawQuote } from "./oddsTypes";

/**
 * Tracks every price over time: opening, previous, peak and lowest price/line per book, a change-only
 * history (odds_history), discrete movements (odds_line_movements) and short-window steam/sharp signals.
 * State lives in memory for fast reads and is persisted so restarts keep openers and history.
 */

export const STEAM_WINDOW_MS = Math.max(1, Number(process.env.ODDS_STEAM_WINDOW_MINUTES ?? 10) || 10) * 60_000;
export const STEAM_MIN_BOOKS = Math.max(2, Number(process.env.ODDS_STEAM_MIN_BOOKS ?? 3) || 3);
const SIGNAL_RETENTION_MS = 60 * 60_000;
/** One point of spread/total is worth roughly three points of win probability in the major US sports. */
const POINT_WEIGHT = 0.03;

export interface MoveEvent {
  sideId: string;
  lineId: string;
  sport: OddsSport;
  gameId: string;
  market: string;
  book: string;
  selection: string;
  participant: string;
  fromAmerican: number;
  toAmerican: number;
  fromPoint: number | null;
  toPoint: number | null;
  probabilityDelta: number;
  /** +1 when the market moved toward this side (shorter price or worse number), -1 away from it. */
  direction: 1 | -1;
  at: number;
}

const states = new Map<string, LineState & { sideId: string }>();
/** Latest observed price per line (the provider's current number). */
const currentPrices = new Map<string, { american: number; point: number | null }>();
const hydratedGames = new Set<string>();
const recentMoves = new Map<OddsSport, MoveEvent[]>();

function categoryOf(quote: RawQuote) {
  return marketDef(quote.sport, quote.market)?.category;
}

export function sideIdOf(quote: RawQuote): string {
  return lineIdentity(quote, categoryOf(quote));
}

export function lineIdOf(quote: RawQuote): string {
  return lineId(quote, categoryOf(quote));
}

/** Score of a move from one side's perspective; positive means the market now likes the side more. */
export function moveScore(quote: Pick<RawQuote, "sport" | "market" | "selection">, from: { american: number; point: number | null }, to: { american: number; point: number | null }): number {
  const probabilityDelta = 1 / americanToDecimal(to.american) - 1 / americanToDecimal(from.american);
  const type = marketDef(quote.sport, quote.market)?.type;
  let pointEffect = 0;
  if (from.point !== null && to.point !== null && from.point !== to.point) {
    if (type === "spread") pointEffect = from.point - to.point;
    else if (/^over$/i.test(quote.selection)) pointEffect = to.point - from.point;
    else if (/^under$/i.test(quote.selection)) pointEffect = from.point - to.point;
  }
  return probabilityDelta + pointEffect * POINT_WEIGHT;
}

export function lineStates(): Map<string, LineState> {
  return states;
}

interface LineRow {
  line_id: string;
  side_id: string;
  price_american: number;
  point: string | null;
  open_american: number;
  open_point: string | null;
  open_at: Date;
  prev_american: number | null;
  prev_point: string | null;
  high_american: number;
  low_american: number;
  high_point: string | null;
  low_point: string | null;
  last_change_at: Date | null;
  last_seen_at: Date;
}

const num = (value: string | null) => value === null ? null : Number(value);

async function hydrate(gameIds: string[]): Promise<void> {
  const missing = [...new Set(gameIds)].filter((id) => !hydratedGames.has(id));
  if (!missing.length) return;
  try {
    const result = await pool.query<LineRow>(
      `SELECT line_id, side_id, price_american, point::text, open_american, open_point::text, open_at, prev_american, prev_point::text,
              high_american, low_american, high_point::text, low_point::text, last_change_at, last_seen_at
       FROM odds_lines WHERE game_id = ANY($1::text[])`,
      [missing],
    );
    for (const row of result.rows) {
      if (states.has(row.line_id)) continue;
      currentPrices.set(row.line_id, { american: row.price_american, point: num(row.point) });
      states.set(row.line_id, {
        sideId: row.side_id,
        openAmerican: row.open_american,
        openPoint: num(row.open_point),
        openAt: row.open_at.toISOString(),
        prevAmerican: row.prev_american,
        prevPoint: num(row.prev_point),
        highAmerican: row.high_american,
        lowAmerican: row.low_american,
        highPoint: num(row.high_point),
        lowPoint: num(row.low_point),
        lastChangeAt: row.last_change_at?.toISOString() ?? null,
        lastSeenAt: row.last_seen_at.toISOString(),
      });
    }
    for (const id of missing) hydratedGames.add(id);
  } catch (error) {
    console.warn("Odds line state load failed", error instanceof Error ? error.message : error);
  }
}

const better = (a: number, b: number) => americanToDecimal(a) > americanToDecimal(b);
const maxPoint = (a: number | null, b: number | null) => a === null ? b : b === null ? a : Math.max(a, b);
const minPoint = (a: number | null, b: number | null) => a === null ? b : b === null ? a : Math.min(a, b);

/**
 * Applies a provider snapshot: creates state for new prices, records changes, and persists
 * new/changed lines plus history. Returns the price changes detected in this snapshot.
 */
export async function recordQuotes(sport: OddsSport, quotes: RawQuote[], now = Date.now()): Promise<MoveEvent[]> {
  await hydrate(quotes.map((quote) => quote.gameId));
  const nowIso = new Date(now).toISOString();
  const changedLines: Array<{ quote: RawQuote; id: string; sideId: string; state: LineState }> = [];
  const moves: MoveEvent[] = [];

  for (const quote of quotes) {
    const id = lineIdOf(quote);
    const sideId = sideIdOf(quote);
    const state = states.get(id);
    if (!state) {
      const open = quote.providerOpen ?? { american: quote.american, point: quote.point };
      const created = {
        sideId,
        openAmerican: open.american,
        openPoint: open.point,
        openAt: nowIso,
        prevAmerican: null,
        prevPoint: null,
        highAmerican: better(open.american, quote.american) ? open.american : quote.american,
        lowAmerican: better(open.american, quote.american) ? quote.american : open.american,
        highPoint: maxPoint(open.point, quote.point),
        lowPoint: minPoint(open.point, quote.point),
        lastChangeAt: null,
        lastSeenAt: nowIso,
      };
      states.set(id, created);
      changedLines.push({ quote, id, sideId, state: created });
      continue;
    }
    state.lastSeenAt = nowIso;
    const current = currentPrices.get(id) ?? null;
    if (current && current.american === quote.american && current.point === quote.point) continue;
    if (current) {
      const score = moveScore(quote, current, { american: quote.american, point: quote.point });
      if (Math.abs(score) >= 0.002) {
        moves.push({
          sideId, lineId: id, sport, gameId: quote.gameId, market: quote.market, book: quote.book,
          selection: quote.selection, participant: quote.participant,
          fromAmerican: current.american, toAmerican: quote.american, fromPoint: current.point, toPoint: quote.point,
          probabilityDelta: 1 / quote.decimal - 1 / americanToDecimal(current.american),
          direction: score > 0 ? 1 : -1,
          at: now,
        });
      }
      state.prevAmerican = current.american;
      state.prevPoint = current.point;
      state.lastChangeAt = nowIso;
    }
    if (better(quote.american, state.highAmerican)) state.highAmerican = quote.american;
    if (better(state.lowAmerican, quote.american)) state.lowAmerican = quote.american;
    state.highPoint = maxPoint(state.highPoint, quote.point);
    state.lowPoint = minPoint(state.lowPoint, quote.point);
    changedLines.push({ quote, id, sideId, state });
  }
  for (const quote of quotes) currentPrices.set(lineIdOf(quote), { american: quote.american, point: quote.point });

  const recent = (recentMoves.get(sport) ?? []).filter((move) => now - move.at < SIGNAL_RETENTION_MS);
  recent.push(...moves);
  recentMoves.set(sport, recent);
  await persist(changedLines, moves, nowIso);
  return moves;
}

async function persist(lines: Array<{ quote: RawQuote; id: string; sideId: string; state: LineState }>, moves: MoveEvent[], nowIso: string): Promise<void> {
  if (!lines.length && !moves.length) return;
  try {
    for (let offset = 0; offset < lines.length; offset += 1000) {
      const batch = lines.slice(offset, offset + 1000);
      const column = <T>(pick: (line: typeof batch[number]) => T) => batch.map(pick);
      await pool.query(
        `INSERT INTO odds_lines(line_id, side_id, game_id, sport, market_key, book_key, selection, participant, point,
           price_american, open_american, open_point, open_at, prev_american, prev_point, high_american, low_american,
           high_point, low_point, last_change_at, first_seen_at, last_seen_at, is_prop)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[],
           $9::numeric[], $10::int[], $11::int[], $12::numeric[], $13::timestamptz[], $14::int[], $15::numeric[], $16::int[],
           $17::int[], $18::numeric[], $19::numeric[], $20::timestamptz[], $21::timestamptz[], $22::timestamptz[], $23::boolean[])
         ON CONFLICT (line_id) DO UPDATE SET point=EXCLUDED.point, price_american=EXCLUDED.price_american,
           prev_american=EXCLUDED.prev_american, prev_point=EXCLUDED.prev_point, high_american=EXCLUDED.high_american,
           low_american=EXCLUDED.low_american, high_point=EXCLUDED.high_point, low_point=EXCLUDED.low_point,
           last_change_at=EXCLUDED.last_change_at, last_seen_at=EXCLUDED.last_seen_at`,
        [
          column((line) => line.id), column((line) => line.sideId), column((line) => line.quote.gameId), column((line) => line.quote.sport),
          column((line) => line.quote.market), column((line) => line.quote.book), column((line) => line.quote.selection),
          column((line) => line.quote.participant), column((line) => line.quote.point), column((line) => line.quote.american),
          column((line) => line.state.openAmerican), column((line) => line.state.openPoint), column((line) => line.state.openAt),
          column((line) => line.state.prevAmerican), column((line) => line.state.prevPoint), column((line) => line.state.highAmerican),
          column((line) => line.state.lowAmerican), column((line) => line.state.highPoint), column((line) => line.state.lowPoint),
          column((line) => line.state.lastChangeAt), column((line) => line.state.openAt), column(() => nowIso),
          column((line) => marketDef(line.quote.sport, line.quote.market)?.category === "prop"),
        ],
      );
      await pool.query(
        `INSERT INTO odds_history(line_id, side_id, game_id, market_key, book_key, point, price_american, observed_at)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::int[], $8::timestamptz[])`,
        [column((line) => line.id), column((line) => line.sideId), column((line) => line.quote.gameId), column((line) => line.quote.market),
          column((line) => line.quote.book), column((line) => line.quote.point), column((line) => line.quote.american), column(() => nowIso)],
      );
    }
    if (moves.length) {
      const column = <T>(pick: (move: MoveEvent) => T) => moves.map(pick);
      await pool.query(
        `INSERT INTO odds_line_movements(side_id, line_id, sport, game_id, market_key, book_key, selection, participant,
           from_american, to_american, from_point, to_point, probability_delta, direction, moved_at)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[],
           $9::int[], $10::int[], $11::numeric[], $12::numeric[], $13::numeric[], $14::smallint[], $15::timestamptz[])`,
        [column((move) => move.sideId), column((move) => move.lineId), column((move) => move.sport), column((move) => move.gameId),
          column((move) => move.market), column((move) => move.book), column((move) => move.selection), column((move) => move.participant),
          column((move) => move.fromAmerican), column((move) => move.toAmerican), column((move) => move.fromPoint), column((move) => move.toPoint),
          column((move) => move.probabilityDelta), column((move) => move.direction), column((move) => new Date(move.at).toISOString())],
      );
    }
  } catch (error) {
    console.warn("Odds history write failed", error instanceof Error ? error.message : error);
  }
}

/** Steam: several books moving the same side the same way inside the window. Sharp: the reference book leads or joins it. */
export function signalsFor(sport: OddsSport, sharpBook: string | null, now = Date.now()): (sideId: string) => SideSignals {
  const bySide = new Map<string, MoveEvent[]>();
  for (const move of recentMoves.get(sport) ?? []) {
    if (now - move.at > STEAM_WINDOW_MS) continue;
    bySide.set(move.sideId, [...(bySide.get(move.sideId) ?? []), move]);
  }
  return (sideId: string) => {
    const moves = bySide.get(sideId) ?? [];
    if (!moves.length) return { steam: false, sharp: false, reverse: false, moves: 0, lastMoveAt: null };
    const up = new Set(moves.filter((move) => move.direction > 0).map((move) => move.book));
    const down = new Set(moves.filter((move) => move.direction < 0).map((move) => move.book));
    const dominant = up.size >= down.size ? up : down;
    const steam = dominant.size >= STEAM_MIN_BOOKS;
    const sharpMoves = sharpBook ? moves.filter((move) => move.book === sharpBook) : [];
    const sharp = sharpMoves.some((move) => Math.abs(move.probabilityDelta) >= 0.02 || (dominant.has(move.book) && dominant.size >= 2));
    return { steam, sharp, reverse: false, moves: moves.length, lastMoveAt: new Date(Math.max(...moves.map((move) => move.at))).toISOString() };
  };
}

export function recentMoveEvents(sport: OddsSport, sinceMs: number, now = Date.now()): MoveEvent[] {
  return (recentMoves.get(sport) ?? []).filter((move) => now - move.at <= sinceMs);
}

export interface MovementRow {
  sideId: string;
  gameId: string;
  market: string;
  book: string;
  selection: string;
  participant: string;
  fromAmerican: number;
  toAmerican: number;
  fromPoint: number | null;
  toPoint: number | null;
  probabilityDelta: number;
  direction: number;
  movedAt: string;
}

export async function listMovements(filters: { sport: OddsSport; gameId?: string; market?: string; hours: number; limit: number }): Promise<MovementRow[]> {
  const result = await pool.query<{
    side_id: string; game_id: string; market_key: string; book_key: string; selection: string; participant: string;
    from_american: number; to_american: number; from_point: string | null; to_point: string | null; probability_delta: string; direction: number; moved_at: Date;
  }>(
    `SELECT side_id, game_id, market_key, book_key, selection, participant, from_american, to_american,
            from_point::text, to_point::text, probability_delta::text, direction, moved_at
     FROM odds_line_movements
     WHERE sport=$1 AND moved_at > NOW() - make_interval(hours => $2)
       AND ($3::text IS NULL OR game_id=$3) AND ($4::text IS NULL OR market_key=$4)
     ORDER BY moved_at DESC LIMIT $5`,
    [filters.sport, filters.hours, filters.gameId ?? null, filters.market ?? null, filters.limit],
  );
  return result.rows.map((row) => ({
    sideId: row.side_id,
    gameId: row.game_id,
    market: row.market_key,
    book: row.book_key,
    selection: row.selection,
    participant: row.participant,
    fromAmerican: row.from_american,
    toAmerican: row.to_american,
    fromPoint: num(row.from_point),
    toPoint: num(row.to_point),
    probabilityDelta: Number(row.probability_delta),
    direction: row.direction,
    movedAt: row.moved_at.toISOString(),
  }));
}

export interface HistoryPoint { book: string; american: number; point: number | null; at: string }

/** Change-only price history for one side across every book (or one book). */
export async function priceHistory(sideId: string, book?: string): Promise<HistoryPoint[]> {
  const result = await pool.query<{ book_key: string; price_american: number; point: string | null; observed_at: Date }>(
    `SELECT book_key, price_american, point::text, observed_at FROM odds_history
     WHERE side_id=$1 AND ($2::text IS NULL OR book_key=$2) ORDER BY observed_at ASC LIMIT 5000`,
    [sideId, book ?? null],
  );
  return result.rows.map((row) => ({ book: row.book_key, american: row.price_american, point: num(row.point), at: row.observed_at.toISOString() }));
}

/* ---------- Market range history (best / worst / average / fair per selection) ---------- */

export interface RangePoint {
  at: string;
  bestAmerican: number;
  bestBook: string;
  worstAmerican: number | null;
  worstBook: string | null;
  averageImplied: number | null;
  fairProbability: number | null;
  books: number;
}

const lastRange = new Map<string, string>();

function rangeSignature(selection: Selection): string {
  const round = (value: number | null | undefined) => value === null || value === undefined ? "" : value.toFixed(3);
  return [selection.best?.american, selection.best?.book, selection.worst?.american, selection.worst?.book, round(selection.average?.implied), round(selection.fair?.probability)].join("|");
}

/** Change-only snapshot of each selection's best and worst price, market average and fair value. */
export async function recordSelectionRanges(sport: OddsSport, selections: Selection[], now = Date.now()): Promise<number> {
  const changed = selections.filter((selection) => {
    if (!selection.best) return false;
    const signature = rangeSignature(selection);
    if (lastRange.get(selection.id) === signature) return false;
    lastRange.set(selection.id, signature);
    return true;
  });
  if (!changed.length) return 0;
  try {
    for (let index = 0; index < changed.length; index += 500) {
      const batch = changed.slice(index, index + 500);
      await pool.query(
        `INSERT INTO odds_selection_history
           (side_id, sport, game_id, market_key, best_american, best_book, worst_american, worst_book, average_implied, fair_probability, books, recorded_at)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[], $6::text[], $7::int[], $8::text[], $9::numeric[], $10::numeric[], $11::int[], $12::timestamptz[])`,
        [
          batch.map((item) => item.id), batch.map(() => sport), batch.map((item) => item.gameId), batch.map((item) => item.market),
          batch.map((item) => item.best!.american), batch.map((item) => item.best!.book),
          batch.map((item) => item.worst?.american ?? null), batch.map((item) => item.worst?.book ?? null),
          batch.map((item) => item.average?.implied ?? null), batch.map((item) => item.fair?.probability ?? null),
          batch.map((item) => item.books.filter((price) => price.priced && price.atLine).length),
          batch.map(() => new Date(now).toISOString()),
        ],
      );
    }
  } catch (error) {
    for (const selection of changed) lastRange.delete(selection.id);
    console.warn("Odds range history write failed", error instanceof Error ? error.message : error);
    return 0;
  }
  return changed.length;
}

export async function rangeHistory(sideId: string, limit = 2000): Promise<RangePoint[]> {
  const result = await pool.query<{ recorded_at: Date; best_american: number; best_book: string; worst_american: number | null; worst_book: string | null; average_implied: string | null; fair_probability: string | null; books: number }>(
    `SELECT recorded_at, best_american, best_book, worst_american, worst_book, average_implied::text, fair_probability::text, books
     FROM (SELECT * FROM odds_selection_history WHERE side_id = $1 ORDER BY recorded_at DESC LIMIT $2) recent ORDER BY recorded_at`,
    [sideId, limit],
  );
  return result.rows.map((row) => ({
    at: row.recorded_at.toISOString(), bestAmerican: row.best_american, bestBook: row.best_book, worstAmerican: row.worst_american, worstBook: row.worst_book,
    averageImplied: row.average_implied === null ? null : Number(row.average_implied), fairProbability: row.fair_probability === null ? null : Number(row.fair_probability), books: row.books,
  }));
}

export async function pruneHistory(): Promise<void> {
  const days = Math.max(1, Number(process.env.ODDS_HISTORY_DAYS ?? 14) || 14);
  await pool.query("DELETE FROM odds_selection_history WHERE recorded_at < NOW() - make_interval(days => $1)", [days]);
  await pool.query("DELETE FROM odds_history WHERE observed_at < NOW() - make_interval(days => $1)", [days]);
  await pool.query("DELETE FROM odds_line_movements WHERE moved_at < NOW() - make_interval(days => $1)", [days]);
  await pool.query("DELETE FROM odds_lines WHERE last_seen_at < NOW() - make_interval(days => $1)", [days]);
}
