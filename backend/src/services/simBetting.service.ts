import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { easternDateOf, fetchScoreboardForDate, type ProviderLiveGame } from "../providers/espnLive";
import type { League } from "../providers/espnStats";
import { syncBankroll } from "./bets";
import { americanToDecimal } from "./evCalculator.service";
import { detailCached, PROP_DEFS } from "./liveGame.service";
import { conferenceLookup, getFutures } from "./ncaa.service";
import { getGame, oddsSnapshot } from "./odds.service";
import { bookByKey, marketDef, ODDS_SPORTS, SPORT_CONFIG, type MarketDef, type OddsSport } from "./oddsCatalog";
import {
  BASKETBALL_PROP_STATS, clvPct, combineDecimal, evPct, gradeGameLeg, gradePropLeg, normalizePlayer, round2, settleWager, teamSimilarity, toAmerican,
  type FinalScore, type LegGrade, type LegStatus, type Settlement, type WagerStatus,
} from "./simGrading";
import { evaluateUser } from "./social/gamification.service";
import { onBetSettled } from "./social/pick.service";
import { cached } from "./statsCache";
import type { Selection } from "./oddsAggregator.service";
import type { OddsGame } from "./oddsTypes";

/**
 * Simulated betting. No real money is wagered anywhere: a slip is priced from the live odds board,
 * its stake is reserved against the user's simulated bankroll, and the wager is graded from final
 * scores. Every wager is mirrored into `bets`, so the tracker, analytics, Sharp Insights, CLV and
 * community features all include simulated action without special cases.
 */

export const MAX_PARLAY_LEGS = 12;
export const MAX_SLIP_WAGERS = 20;
export const MAX_PAYOUT = 1_000_000;
/** A live price older than this is treated as suspended. */
const LIVE_QUOTE_MAX_AGE_MS = 3 * 60 * 1000;
/** Futures and wagers the grader could not settle can be settled by hand after this long. */
const MANUAL_SETTLE_AFTER_MS = 36 * 60 * 60 * 1000;
const FUTURE_VOID_WINDOW_MS = 10 * 60 * 1000;
export const GRADING_MINUTES = Math.max(1, Number(process.env.SIM_GRADING_MINUTES ?? 5) || 5);

export type BetType = "moneyline" | "spread" | "total" | "team_total" | "player_prop" | "parlay" | "sgp" | "future";

export class SlipError extends Error {
  constructor(message: string, readonly status = 400, readonly details?: unknown) {
    super(message);
    this.name = "SlipError";
  }
}

export type SlipLegInput =
  | { kind: "market"; sport: OddsSport; gameId: string; selectionId: string; book: string; american: number; stake?: number }
  | { kind: "future"; marketId: string; outcome: string; american: number; stake?: number };

export interface SlipInput {
  mode: "single" | "parlay";
  legs: SlipLegInput[];
  /** Parlay stake. Singles carry their own stake per leg. */
  stake?: number;
  /** Place at the current price when it moved since the slip was built. */
  acceptOddsChanges?: boolean;
}

export interface PricedLeg {
  index: number;
  sport: OddsSport;
  gameId: string;
  event: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string | null;
  marketKey: string;
  marketLabel: string;
  marketType: MarketDef["type"] | "future";
  period: string;
  selection: string;
  participant: string;
  point: number | null;
  label: string;
  conference: string;
  book: string;
  bookName: string;
  lineId: string | null;
  american: number;
  decimal: number;
  fairProbability: number | null;
  /** The price the user saw, when the board has moved since. */
  requestedAmerican: number;
  changed: boolean;
  live: boolean;
}

export interface PricedWager {
  betType: BetType;
  description: string;
  sport: OddsSport;
  conference: string;
  book: string;
  bookName: string;
  stake: number;
  decimal: number;
  american: number;
  payout: number;
  profit: number;
  fairProbability: number | null;
  evPct: number | null;
  units: number;
  riskPct: number;
  legs: PricedLeg[];
}

export interface BankrollOverview {
  startingBankroll: number;
  /** Settled balance: starting bankroll plus the profit and loss of every graded bet. */
  currentBankroll: number;
  unitSize: number;
  /** Stake tied up in open simulated wagers. */
  exposure: number;
  /** What can still be staked: current bankroll minus exposure. */
  available: number;
  pendingBets: number;
  potentialPayout: number;
  riskPct: number;
  exposureUnits: number;
}

export interface SlipQuote {
  mode: "single" | "parlay";
  slipType: "single" | "parlay" | "sgp";
  wagers: PricedWager[];
  totalStake: number;
  totalPayout: number;
  bankroll: BankrollOverview;
  availableAfter: number;
  oddsChanged: boolean;
  /** Reasons the slip cannot be placed as it stands (empty when it is ready). */
  problems: string[];
  notes: string[];
}

const BET_TYPE_LABEL: Record<BetType, string> = {
  moneyline: "Moneyline", spread: "Spread", total: "Total", team_total: "Team total", player_prop: "Player prop", parlay: "Parlay", sgp: "Same game parlay", future: "Future",
};

function betTypeOf(type: PricedLeg["marketType"]): BetType {
  if (type === "future") return "future";
  if (type === "moneyline" || type === "spread" || type === "total" || type === "team_total") return type;
  return "player_prop";
}

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

/* ---------- Bankroll ---------- */

type Queryable = Pick<PoolClient, "query">;

export async function bankrollOverview(userId: number, db: Queryable = pool, lock = false): Promise<BankrollOverview> {
  await db.query("INSERT INTO bankroll(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
  const bankroll = await db.query<{ starting_bankroll: string; current_bankroll: string; unit_size: string }>(
    `SELECT starting_bankroll, current_bankroll, unit_size FROM bankroll WHERE user_id=$1${lock ? " FOR UPDATE" : ""}`, [userId],
  );
  const open = await db.query<{ exposure: string; pending: string; payout: string }>(
    "SELECT COALESCE(SUM(stake),0) AS exposure, COUNT(*) AS pending, COALESCE(SUM(potential_payout),0) AS payout FROM simulated_bets WHERE user_id=$1 AND status='open'", [userId],
  );
  const row = bankroll.rows[0]!;
  const current = Number(row.current_bankroll);
  const unit = Number(row.unit_size) || 1;
  const exposure = Number(open.rows[0]!.exposure);
  return {
    startingBankroll: Number(row.starting_bankroll),
    currentBankroll: current,
    unitSize: unit,
    exposure,
    available: round2(Math.max(0, current - exposure)),
    pendingBets: Number(open.rows[0]!.pending),
    potentialPayout: Number(open.rows[0]!.payout),
    riskPct: current > 0 ? round2(exposure / current * 100) : 0,
    exposureUnits: round2(exposure / unit),
  };
}

async function recordTransaction(db: Queryable, userId: number, kind: "stake" | "payout" | "refund" | "adjustment", amount: number, simBetId: string | null, note: string): Promise<void> {
  const overview = await bankrollOverview(userId, db);
  await db.query(
    "INSERT INTO bankroll_transactions(user_id, kind, amount, balance_after, sim_bet_id, note) VALUES($1,$2,$3,$4,$5,$6)",
    [userId, kind, round2(amount), overview.available, simBetId, note.slice(0, 240)],
  );
}

/** Logs a change of the starting bankroll so the ledger explains every balance movement. */
export async function recordAdjustment(db: Queryable, userId: number, delta: number, note: string): Promise<void> {
  if (Math.abs(delta) >= 0.005) await recordTransaction(db, userId, "adjustment", delta, null, note);
}

/* ---------- Pricing ---------- */

async function priceMarketLeg(input: Extract<SlipLegInput, { kind: "market" }>, index: number, conferenceOf: (team: string) => string): Promise<PricedLeg> {
  const marketKey = input.selectionId.split("|")[1] ?? "";
  const def = marketDef(input.sport, marketKey);
  if (!def) throw new SlipError("That market is not supported.");
  // Moneyline, spread and total come from the board already in memory. Only period, team-total,
  // alternate and prop markets need the per-game request (which costs provider credits).
  let game: (OddsGame & { label?: string }) | undefined;
  let selection: Selection | undefined;
  if (def.featured) {
    const board = await oddsSnapshot(input.sport).catch(() => null);
    game = board?.games.find((item) => item.id === input.gameId);
    selection = board?.selections.find((item) => item.id === input.selectionId);
  } else {
    const view = await getGame(input.sport, input.gameId, { props: def.category === "prop" }).catch(() => null);
    game = view?.game;
    selection = view?.markets.flatMap((market) => market.selections).find((item) => item.id === input.selectionId);
  }
  const price = selection?.books.find((book) => book.book === input.book);
  if (!game || !selection || !price) throw new SlipError(`${def.label} is no longer offered${bookByKey(input.book) ? ` at ${bookByKey(input.book)!.name}` : ""}. Remove it from the slip.`, 409);
  const gameLabel = `${game.awayTeam} @ ${game.homeTeam}`;
  if (game.status === "final") throw new SlipError(`${gameLabel} has finished.`, 409);
  const started = new Date(game.commenceTime).getTime() <= Date.now();
  if (started && Date.now() - new Date(price.lastSeenAt).getTime() > LIVE_QUOTE_MAX_AGE_MS) {
    throw new SlipError(`${gameLabel} is in progress and ${bookByKey(input.book)?.name ?? input.book} has no current live price for this market.`, 409);
  }
  const point = price.point;
  const pointText = point === null ? "" : def.type === "spread" ? ` ${point === 0 ? "PK" : signed(point)}` : ` ${point}`;
  const subject = selection.participant ? `${selection.participant} ${selection.selection}` : selection.selection;
  // Conference bucket for NCAA analytics: the shared league, otherwise a non-conference game.
  const home = input.sport === "ncaab" ? conferenceOf(game.homeTeam) : "";
  const away = input.sport === "ncaab" ? conferenceOf(game.awayTeam) : "";
  return {
    index,
    sport: input.sport,
    gameId: game.id,
    event: gameLabel,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    commenceTime: game.commenceTime,
    marketKey: def.key,
    marketLabel: def.label,
    marketType: def.type,
    period: def.period,
    selection: selection.selection,
    participant: selection.participant,
    point,
    label: `${subject}${pointText}${def.type === "moneyline" && def.period === "game" ? " ML" : ` · ${def.label}`}`,
    conference: input.sport !== "ncaab" ? "" : home && home === away ? home : home || away ? "Non-conference" : "",
    book: price.book,
    bookName: bookByKey(price.book)?.name ?? price.book,
    lineId: `${selection.id}|${price.book}`,
    american: price.american,
    decimal: price.decimal,
    // The no-vig probability is for the market's main line; a book hanging another number is not comparable.
    fairProbability: price.atLine ? selection.fair?.probability ?? null : null,
    requestedAmerican: input.american,
    changed: price.american !== input.american,
    live: started,
  };
}

async function priceFutureLeg(input: Extract<SlipLegInput, { kind: "future" }>, index: number): Promise<PricedLeg> {
  const futures = await getFutures();
  const market = futures.markets.find((item) => item.id === input.marketId);
  const outcome = market?.outcomes.find((item) => item.name === input.outcome);
  if (!market || !outcome) throw new SlipError("That futures market is no longer offered. Remove it from the slip.", 409);
  return {
    index,
    sport: "ncaab",
    gameId: `future:${market.id}`,
    event: `${futures.season.displayName} ${market.name}`,
    homeTeam: "",
    awayTeam: "",
    commenceTime: null,
    marketKey: "outrights",
    marketLabel: market.name,
    marketType: "future",
    period: "season",
    selection: outcome.name,
    participant: "",
    point: null,
    label: `${outcome.name} · ${market.name}`,
    conference: market.conference ?? "",
    book: market.book,
    bookName: bookByKey(market.book)?.name ?? market.bookName,
    lineId: null,
    american: outcome.american,
    decimal: americanToDecimal(outcome.american),
    fairProbability: null,
    requestedAmerican: input.american,
    changed: outcome.american !== input.american,
    live: false,
  };
}

function wagerFrom(legs: PricedLeg[], stake: number, bankroll: BankrollOverview, slipType: "single" | "parlay" | "sgp"): PricedWager {
  const decimal = combineDecimal(legs.map((leg) => leg.decimal));
  const first = legs[0]!;
  const fair = legs.every((leg) => leg.fairProbability !== null) ? legs.reduce((total, leg) => total * leg.fairProbability!, 1) : null;
  const payout = round2(stake * decimal);
  const conferences = [...new Set(legs.map((leg) => leg.conference).filter(Boolean))];
  return {
    betType: slipType === "single" ? betTypeOf(first.marketType) : slipType,
    description: slipType === "single" ? first.label : `${legs.length}-leg ${slipType === "sgp" ? "same game parlay" : "parlay"}: ${legs.map((leg) => leg.label).join(" + ")}`.slice(0, 400),
    sport: first.sport,
    conference: conferences.length === 1 ? conferences[0]! : "",
    book: first.book,
    bookName: first.bookName,
    stake: round2(stake),
    decimal,
    american: slipType === "single" ? first.american : toAmerican(decimal),
    payout,
    profit: round2(payout - stake),
    fairProbability: fair,
    evPct: evPct(fair, decimal),
    units: round2(stake / bankroll.unitSize),
    riskPct: bankroll.currentBankroll > 0 ? round2(stake / bankroll.currentBankroll * 100) : 0,
    legs,
  };
}

/** Prices a slip against the live board and the user's bankroll without placing anything. */
export async function quoteSlip(userId: number, input: SlipInput, db: Queryable = pool, lock = false): Promise<SlipQuote> {
  if (!input.legs.length) throw new SlipError("Add at least one selection to the bet slip.");
  if (input.mode === "parlay" && input.legs.length < 2) throw new SlipError("A parlay needs at least two selections.");
  if (input.mode === "parlay" && input.legs.length > MAX_PARLAY_LEGS) throw new SlipError(`Parlays are limited to ${MAX_PARLAY_LEGS} legs.`);
  if (input.legs.length > MAX_SLIP_WAGERS) throw new SlipError(`A slip holds up to ${MAX_SLIP_WAGERS} selections.`);
  const conferenceOf = input.legs.some((leg) => leg.kind === "market" && leg.sport === "ncaab") ? await conferenceLookup() : () => "";
  const legs = await Promise.all(input.legs.map((leg, index) => leg.kind === "future" ? priceFutureLeg(leg, index) : priceMarketLeg(leg, index, conferenceOf)));
  const bankroll = await bankrollOverview(userId, db, lock);
  const problems: string[] = [];
  const notes: string[] = [];
  const keys = legs.map((leg) => `${leg.gameId}|${leg.marketKey}|${leg.participant}|${leg.selection}|${leg.point ?? ""}`);
  if (new Set(keys).size !== keys.length) problems.push("The same selection is on the slip twice.");

  let slipType: SlipQuote["slipType"] = "single";
  let wagers: PricedWager[];
  if (input.mode === "parlay") {
    const games = new Set(legs.map((leg) => leg.gameId));
    slipType = games.size < legs.length ? "sgp" : "parlay";
    if (legs.some((leg) => leg.marketType === "future")) problems.push("Futures can only be placed as single bets.");
    if (new Set(legs.map((leg) => leg.book)).size > 1) problems.push("A parlay is placed at one sportsbook. Pick the same book for every leg.");
    // Two sides of one market (or two numbers on it) cannot both be in a parlay.
    const markets = legs.map((leg) => `${leg.gameId}|${leg.marketKey}|${leg.participant}`);
    if (new Set(markets).size !== markets.length) problems.push("Two legs are on the same market. Keep one of them.");
    if (slipType === "sgp") notes.push("Same game parlay legs are correlated. Sportsbooks price them below the product of the legs; this simulation pays the uncorrelated product, so treat the payout as a ceiling.");
    wagers = [wagerFrom(legs, input.stake ?? 0, bankroll, slipType)];
  } else {
    wagers = legs.map((leg, index) => wagerFrom([leg], input.legs[index]!.stake ?? input.stake ?? 0, bankroll, "single"));
  }
  for (const wager of wagers) {
    if (!(wager.stake > 0)) problems.push(input.mode === "parlay" ? "Enter a stake." : `Enter a stake for ${wager.legs[0]!.label}.`);
    if (wager.payout > MAX_PAYOUT) problems.push(`Payouts are capped at $${MAX_PAYOUT.toLocaleString()} per wager. Lower the stake.`);
  }
  const totalStake = round2(wagers.reduce((total, wager) => total + wager.stake, 0));
  if (totalStake > bankroll.available + 0.001) problems.push(`The slip stakes $${totalStake.toFixed(2)} but only $${bankroll.available.toFixed(2)} of the simulated bankroll is available.`);
  const oddsChanged = legs.some((leg) => leg.changed);
  if (legs.some((leg) => leg.live)) notes.push("One or more games are in progress: the slip uses the current live price.");
  return {
    mode: input.mode,
    slipType,
    wagers,
    totalStake,
    totalPayout: round2(wagers.reduce((total, wager) => total + wager.payout, 0)),
    bankroll,
    availableAfter: round2(bankroll.available - totalStake),
    oddsChanged,
    problems: [...new Set(problems)],
    notes,
  };
}

/* ---------- Placement ---------- */

export interface PlacedSlip { slipId: string; wagerIds: string[]; betIds: number[]; quote: SlipQuote; bankroll: BankrollOverview }

export async function placeSlip(userId: number, input: SlipInput): Promise<PlacedSlip> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The bankroll row is locked for the whole placement so two slips cannot spend the same balance.
    const quote = await quoteSlip(userId, input, client, true);
    if (quote.problems.length) throw new SlipError(quote.problems[0]!, 400, { problems: quote.problems });
    if (quote.oddsChanged && !input.acceptOddsChanges) {
      throw new SlipError("Odds changed since you built the slip. Review the new prices and submit again.", 409, { quote });
    }
    const legCount = quote.wagers.reduce((total, wager) => total + wager.legs.length, 0);
    const slip = await client.query<{ id: string }>(
      "INSERT INTO bet_slips(user_id, slip_type, wager_count, leg_count, total_stake, potential_payout) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [userId, quote.slipType, quote.wagers.length, legCount, quote.totalStake, quote.totalPayout],
    );
    const slipId = slip.rows[0]!.id;
    const wagerIds: string[] = [];
    const betIds: number[] = [];
    for (const wager of quote.wagers) {
      const single = wager.legs.length === 1 ? wager.legs[0]! : null;
      const label = SPORT_CONFIG[wager.sport].label;
      const bet = await client.query<{ id: number }>(
        `INSERT INTO bets (user_id, sport, league, event, bet_type, team_player, odds, stake, result, profit_loss, sportsbook, bet_date,
           market_key, selection, line_value, event_id, notes, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',0,$9,NOW(),$10,$11,$12,$13,$14,'simulated') RETURNING id`,
        [userId, label, wager.sport === "ncaab" ? "NCAA Men's Basketball" : label,
          (single ? single.event : `${wager.legs.length}-leg ${wager.betType === "sgp" ? "same game parlay" : "parlay"}`).slice(0, 180),
          BET_TYPE_LABEL[wager.betType], (single ? single.participant || single.selection : "").slice(0, 120), Math.round(wager.decimal * 1000) / 1000, wager.stake, wager.bookName,
          single ? single.marketKey : wager.betType, wager.description.slice(0, 180), single?.point ?? null, single && single.marketType !== "future" ? single.gameId : null,
          "Simulated wager · graded automatically"],
      );
      const betId = bet.rows[0]!.id;
      const sim = await client.query<{ id: string }>(
        `INSERT INTO simulated_bets(slip_id, user_id, bet_id, bet_type, sport, conference, sportsbook, book_key, description, stake, odds_decimal, odds_american,
           potential_payout, units, risk_pct, bankroll_before, fair_probability, ev_pct)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [slipId, userId, betId, wager.betType, wager.sport, wager.conference, wager.bookName, wager.book, wager.description, wager.stake, wager.decimal, wager.american,
          wager.payout, wager.units, wager.riskPct, quote.bankroll.available, wager.fairProbability, wager.evPct],
      );
      const simId = sim.rows[0]!.id;
      for (const leg of wager.legs) {
        await client.query(
          `INSERT INTO simulated_bet_legs(sim_bet_id, leg_index, sport, game_id, espn_event_id, event, home_team, away_team, commence_time, market_key, market_type, period,
             selection, participant, point, label, conference, book_key, line_id, odds_american, odds_decimal, fair_probability)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
          [simId, leg.index, leg.sport, leg.gameId, leg.gameId.startsWith("espn-") ? leg.gameId.slice(5) : null, leg.event, leg.homeTeam, leg.awayTeam, leg.commenceTime,
            leg.marketKey, leg.marketType, leg.period, leg.selection, leg.participant, leg.point, leg.label.slice(0, 300), leg.conference, leg.book, leg.lineId, leg.american, leg.decimal, leg.fairProbability],
        );
      }
      await recordTransaction(client, userId, "stake", -wager.stake, simId, `Stake: ${wager.description}`);
      wagerIds.push(simId);
      betIds.push(betId);
    }
    const bankroll = await bankrollOverview(userId, client);
    await client.query("COMMIT");
    void evaluateUser(userId);
    return { slipId, wagerIds, betIds, quote, bankroll };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/* ---------- Reading wagers ---------- */

interface LegRow {
  id: string; sim_bet_id: string; leg_index: number; sport: string; game_id: string; espn_event_id: string | null; event: string; home_team: string; away_team: string;
  commence_time: Date | null; market_key: string; market_type: string; period: string; selection: string; participant: string; point: string | null; label: string;
  conference: string; book_key: string; line_id: string | null; odds_american: number; odds_decimal: string; fair_probability: string | null; closing_american: number | null;
  status: LegStatus; result_value: string | null; result_note: string; graded_at: Date | null;
}
interface WagerRow {
  id: string; slip_id: string; user_id: number; bet_id: number; bet_type: BetType; sport: string; conference: string; sportsbook: string; book_key: string; description: string;
  stake: string; odds_decimal: string; odds_american: number; potential_payout: string; status: WagerStatus; payout: string; profit_loss: string; units: string; risk_pct: string;
  fair_probability: string | null; ev_pct: string | null; closing_odds_decimal: string | null; clv_pct: string | null; placed_at: Date; settled_at: Date | null;
}

const numberOrNull = (value: string | number | null) => (value === null ? null : Number(value));

function wagerView(row: WagerRow, legs: LegRow[]) {
  const mine = legs.filter((leg) => leg.sim_bet_id === row.id).sort((a, b) => a.leg_index - b.leg_index);
  const starts = mine.map((leg) => leg.commence_time?.getTime()).filter((time): time is number => typeof time === "number");
  const firstStart = starts.length ? Math.min(...starts) : null;
  const isFuture = row.bet_type === "future";
  const open = row.status === "open";
  return {
    id: row.id,
    slipId: row.slip_id,
    betId: row.bet_id,
    betType: row.bet_type,
    betTypeLabel: BET_TYPE_LABEL[row.bet_type],
    sport: row.sport,
    conference: row.conference,
    sportsbook: row.sportsbook,
    description: row.description,
    stake: Number(row.stake),
    oddsDecimal: Number(row.odds_decimal),
    oddsAmerican: row.odds_american,
    potentialPayout: Number(row.potential_payout),
    status: row.status,
    payout: Number(row.payout),
    profitLoss: Number(row.profit_loss),
    units: Number(row.units),
    riskPct: Number(row.risk_pct),
    fairProbability: numberOrNull(row.fair_probability),
    evPct: numberOrNull(row.ev_pct),
    closingOddsDecimal: numberOrNull(row.closing_odds_decimal),
    clvPct: numberOrNull(row.clv_pct),
    placedAt: row.placed_at.toISOString(),
    settledAt: row.settled_at?.toISOString() ?? null,
    startsAt: firstStart ? new Date(firstStart).toISOString() : null,
    /** A wager can be cancelled for a full refund until its first game starts (futures: for ten minutes). */
    canVoid: open && (isFuture ? Date.now() - row.placed_at.getTime() < FUTURE_VOID_WINDOW_MS : firstStart !== null && firstStart > Date.now()),
    /** Futures, and wagers the grader could not settle a day and a half after the game, are settled by hand. */
    canSettle: open && (isFuture || (firstStart !== null && Date.now() - Math.max(...starts) > MANUAL_SETTLE_AFTER_MS)),
    legs: mine.map((leg) => ({
      id: leg.id, sport: leg.sport, gameId: leg.game_id, event: leg.event, commenceTime: leg.commence_time?.toISOString() ?? null, marketKey: leg.market_key, marketType: leg.market_type,
      period: leg.period, selection: leg.selection, participant: leg.participant, point: numberOrNull(leg.point), label: leg.label, conference: leg.conference, book: leg.book_key,
      oddsAmerican: leg.odds_american, oddsDecimal: Number(leg.odds_decimal), closingAmerican: leg.closing_american, status: leg.status, resultValue: numberOrNull(leg.result_value), resultNote: leg.result_note,
    })),
  };
}
export type WagerView = ReturnType<typeof wagerView>;

async function loadWagers(where: string, params: unknown[], db: Queryable = pool): Promise<WagerView[]> {
  const wagers = await db.query<WagerRow>(`SELECT * FROM simulated_bets s WHERE ${where}`, params);
  if (!wagers.rows.length) return [];
  const legs = await db.query<LegRow>("SELECT * FROM simulated_bet_legs WHERE sim_bet_id = ANY($1::bigint[])", [wagers.rows.map((row) => row.id)]);
  return wagers.rows.map((row) => wagerView(row, legs.rows));
}

export async function listOpenWagers(userId: number) {
  const [wagers, bankroll] = await Promise.all([loadWagers("s.user_id=$1 AND s.status='open' ORDER BY s.placed_at DESC LIMIT 500", [userId]), bankrollOverview(userId)]);
  return { wagers, bankroll };
}

export async function listWagerHistory(userId: number, filters: { status?: "open" | "settled" | WagerStatus; sport?: string; limit?: number } = {}) {
  const status = filters.status === "settled" ? "s.status <> 'open'" : filters.status ? "s.status = $3" : "TRUE";
  const params: unknown[] = [userId, filters.sport ?? null];
  if (filters.status && filters.status !== "settled") params.push(filters.status);
  const limit = Math.min(500, Math.max(1, filters.limit ?? 100));
  return { wagers: await loadWagers(`s.user_id=$1 AND ($2::text IS NULL OR s.sport=$2) AND ${status} ORDER BY COALESCE(s.settled_at, s.placed_at) DESC LIMIT ${limit}`, params) };
}

/* ---------- Settlement ---------- */

function closingDecimal(legs: LegRow[]): number | null {
  if (!legs.length || legs.some((leg) => leg.closing_american === null)) return null;
  return combineDecimal(legs.map((leg) => americanToDecimal(leg.closing_american!)));
}

/** Applies a settlement to the wager, its mirrored bet, the bankroll and the ledger. Runs inside a transaction. */
async function applySettlement(client: PoolClient, wager: WagerRow, legs: LegRow[], settlement: Settlement, note: string): Promise<void> {
  const closing = closingDecimal(legs);
  const clv = clvPct(Number(wager.odds_decimal), closing);
  const updated = await client.query(
    `UPDATE simulated_bets SET status=$1, payout=$2, profit_loss=$3, closing_odds_decimal=$4, clv_pct=$5, settled_at=NOW() WHERE id=$6 AND status='open'`,
    [settlement.status, settlement.payout, settlement.profitLoss, closing, clv, wager.id],
  );
  if (!updated.rowCount) return;
  // The mirrored bet keeps win/loss/push; a reduced parlay records the odds it was actually paid at.
  const result = settlement.status === "won" ? "win" : settlement.status === "lost" ? "loss" : "push";
  const paidOdds = settlement.status === "won" ? Math.max(1.001, Math.round(settlement.decimal * 1000) / 1000) : null;
  await client.query(
    `UPDATE bets SET result=$1, profit_loss=$2, odds=COALESCE($3, odds), closing_odds=$4, graded_at=NOW(), notes=$5 WHERE id=$6`,
    [result, settlement.profitLoss, paidOdds, closing && closing > 1 ? Math.round(closing * 1000) / 1000 : null, `Simulated wager · ${note}`.slice(0, 2000), wager.bet_id],
  );
  await syncBankroll(client, wager.user_id);
  if (settlement.status === "won") await recordTransaction(client, wager.user_id, "payout", settlement.payout, wager.id, `Won: ${wager.description}`);
  else if (settlement.status !== "lost") await recordTransaction(client, wager.user_id, "refund", settlement.payout, wager.id, `${settlement.status === "push" ? "Push" : "Void"}: ${wager.description}`);
}

async function withWager<T>(userId: number, wagerId: string, work: (client: PoolClient, wager: WagerRow, legs: LegRow[]) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const wager = await client.query<WagerRow>("SELECT * FROM simulated_bets WHERE id=$1 AND user_id=$2 FOR UPDATE", [wagerId, userId]);
    if (!wager.rows[0]) throw new SlipError("Wager not found.", 404);
    if (wager.rows[0].status !== "open") throw new SlipError("This wager has already been settled.", 409);
    const legs = await client.query<LegRow>("SELECT * FROM simulated_bet_legs WHERE sim_bet_id=$1 ORDER BY leg_index", [wagerId]);
    const result = await work(client, wager.rows[0], legs.rows);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Cancels an open wager before its first game starts and returns the stake. */
export async function voidWager(userId: number, wagerId: string): Promise<BankrollOverview> {
  await withWager(userId, wagerId, async (client, wager, legs) => {
    const view = wagerView(wager, legs);
    if (!view.canVoid) throw new SlipError(wager.bet_type === "future" ? "Futures can be cancelled for ten minutes after they are placed." : "This wager can no longer be cancelled: a game has started.", 409);
    await client.query("UPDATE simulated_bet_legs SET status='void', result_note='Cancelled before the start', graded_at=NOW() WHERE sim_bet_id=$1", [wagerId]);
    await applySettlement(client, wager, legs, { status: "void", decimal: 1, payout: Number(wager.stake), profitLoss: 0 }, "cancelled before the start, stake refunded");
  });
  return bankrollOverview(userId);
}

/** Settles a future (or a wager the grader could not resolve) by hand. */
export async function settleWagerManually(userId: number, wagerId: string, result: "won" | "lost" | "push"): Promise<BankrollOverview> {
  const betId = await withWager(userId, wagerId, async (client, wager, legs) => {
    if (!wagerView(wager, legs).canSettle) throw new SlipError("This wager is graded automatically once its games finish.", 409);
    const status: LegStatus = result === "push" ? "void" : result;
    await client.query("UPDATE simulated_bet_legs SET status=$2, result_note='Settled manually', graded_at=NOW() WHERE sim_bet_id=$1 AND status='open'", [wagerId, status]);
    const final = legs.map((leg) => ({ status: leg.status === "open" ? status : leg.status, decimal: Number(leg.odds_decimal) }));
    const settlement = settleWager(Number(wager.stake), final);
    if (!settlement) throw new SlipError("Could not settle this wager.", 409);
    await applySettlement(client, wager, legs, settlement, "settled manually");
    return wager.bet_id;
  });
  void onBetSettled(userId, betId, "manual");
  void evaluateUser(userId);
  return bankrollOverview(userId);
}

/* ---------- Automatic grading ---------- */

function finalScore(game: ProviderLiveGame): FinalScore | null {
  if (game.home.score === null || game.away.score === null) return null;
  return { home: game.home.score, away: game.away.score, homeLines: game.home.linescores, awayLines: game.away.linescores };
}

const isLeague = (sport: string): sport is League => (ODDS_SPORTS as string[]).includes(sport);

function scoreboard(league: League, date: string) {
  return cached(`sim:scoreboard:${league}:${date}`, 60_000, () => fetchScoreboardForDate(league, date)).then((result) => result.data);
}

/** How confidently a scoreboard game is the leg's game: both names, or one name plus the same tip time. */
export function gameMatchScore(leg: { home: string; away: string; start: number }, game: { home: string; away: string; start: number }): number {
  const home = teamSimilarity(leg.home, game.home);
  const away = teamSimilarity(leg.away, game.away);
  const sameTime = Math.abs(leg.start - game.start) <= 20 * 60 * 1000;
  if (home === 1 && away === 1) return 3;
  if (sameTime && (home === 1 || away === 1) && Math.min(home, away) >= 0.3) return 2;
  if (sameTime && home >= 0.5 && away >= 0.5) return 1;
  return 0;
}

async function findGame(leg: LegRow): Promise<ProviderLiveGame | null> {
  if (!isLeague(leg.sport) || !leg.commence_time) return null;
  const mine = { home: leg.home_team, away: leg.away_team, start: leg.commence_time.getTime() };
  // The provider files a game under its US Eastern date; a rescheduled game can slip a day either way.
  for (const offset of [0, -1, 1]) {
    const games = await scoreboard(leg.sport, easternDateOf(leg.commence_time.getTime() + offset * 86_400_000)).catch(() => [] as ProviderLiveGame[]);
    if (leg.espn_event_id) {
      const exact = games.find((game) => game.id === leg.espn_event_id);
      if (exact) return exact;
      continue;
    }
    // Books and score providers spell college teams differently ("Florida St" / "Florida State").
    const ranked = games.map((game) => ({ game, score: gameMatchScore(mine, { home: game.home.name, away: game.away.name, start: Date.parse(game.startTime) }) }))
      .filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
    if (ranked[0] && (ranked.length === 1 || ranked[0].score > ranked[1]!.score)) return ranked[0].game;
  }
  return null;
}

async function gradeProp(leg: LegRow, game: ProviderLiveGame): Promise<LegGrade | null> {
  const detail = await detailCached(game.league, game.id).then((result) => result.data).catch(() => null);
  if (!detail) return null;
  const wanted = normalizePlayer(leg.participant);
  const player = detail.box.flatMap((team) => team.groups).flatMap((group) => group.players).find((row) => normalizePlayer(row.name) === wanted);
  const stat = (game.league === "nba" || game.league === "ncaab" ? BASKETBALL_PROP_STATS[leg.market_key] : undefined)
    ?? PROP_DEFS[game.league].find((def) => def.market === leg.market_key)?.current;
  if (!stat) return null;
  const played = Boolean(player && !player.didNotPlay);
  return gradePropLeg({ marketType: leg.market_type, selection: leg.selection, point: numberOrNull(leg.point) }, player ? stat(player.values) : null, played);
}

async function gradeLeg(leg: LegRow): Promise<(LegGrade & { espnEventId: string }) | null> {
  const game = await findGame(leg);
  if (!game) return null;
  if (game.status === "postponed") return { status: "void", value: null, note: "Game postponed or cancelled", espnEventId: game.id };
  if (game.status !== "final") return null;
  const score = finalScore(game);
  if (!score) return null;
  const grade = leg.market_type.startsWith("prop")
    ? await gradeProp(leg, game)
    : gradeGameLeg({ sport: leg.sport, marketKey: leg.market_key, marketType: leg.market_type, period: leg.period, selection: leg.selection, participant: leg.participant, point: numberOrNull(leg.point), homeTeam: leg.home_team, awayTeam: leg.away_team }, score);
  return grade ? { ...grade, espnEventId: game.id } : null;
}

/** The last price a book showed before the game started (from the odds history the board already keeps). */
async function captureClosing(leg: LegRow): Promise<void> {
  if (!leg.line_id || !leg.commence_time || leg.closing_american !== null) return;
  const history = await pool.query<{ price_american: number }>(
    "SELECT price_american FROM odds_history WHERE line_id=$1 AND observed_at <= $2 ORDER BY observed_at DESC LIMIT 1", [leg.line_id, leg.commence_time],
  ).catch(() => null);
  const current = history?.rows[0] ? null : await pool.query<{ price_american: number }>("SELECT price_american FROM odds_lines WHERE line_id=$1 AND first_seen_at <= $2", [leg.line_id, leg.commence_time]).catch(() => null);
  const closing = history?.rows[0]?.price_american ?? current?.rows[0]?.price_american ?? null;
  if (closing === null) return;
  leg.closing_american = closing;
  await pool.query("UPDATE simulated_bet_legs SET closing_american=$1 WHERE id=$2", [closing, leg.id]);
}

export interface GradeResult { checked: number; legsGraded: number; settled: number; won: number; lost: number; refunded: number }

/** Grades every open wager whose games have started (one user's, or everyone's from the scheduler). */
export async function gradeOpenWagers(userId?: number): Promise<GradeResult> {
  const legs = await pool.query<LegRow & { user_id: number }>(
    `SELECT l.*, s.user_id FROM simulated_bet_legs l JOIN simulated_bets s ON s.id = l.sim_bet_id
     WHERE s.status='open' AND l.status='open' AND l.market_type <> 'future' AND l.commence_time <= NOW() AND ($1::int IS NULL OR s.user_id=$1)
     ORDER BY l.commence_time LIMIT 2000`,
    [userId ?? null],
  );
  const result: GradeResult = { checked: legs.rows.length, legsGraded: 0, settled: 0, won: 0, lost: 0, refunded: 0 };
  const touched = new Map<string, number>();
  for (const leg of legs.rows) {
    try {
      await captureClosing(leg);
      const grade = await gradeLeg(leg);
      if (!grade) continue;
      await pool.query(
        "UPDATE simulated_bet_legs SET status=$1, result_value=$2, result_note=$3, espn_event_id=$4, graded_at=NOW() WHERE id=$5 AND status='open'",
        [grade.status, grade.value, grade.note.slice(0, 200), grade.espnEventId, leg.id],
      );
      result.legsGraded += 1;
      touched.set(leg.sim_bet_id, leg.user_id);
    } catch (error) {
      console.warn("Could not grade simulated leg", leg.id, error instanceof Error ? error.message : error);
    }
  }
  for (const [wagerId, owner] of touched) {
    try {
      const settled = await withWager(owner, wagerId, async (client, wager, wagerLegs) => {
        const settlement = settleWager(Number(wager.stake), wagerLegs.map((leg) => ({ status: leg.status, decimal: Number(leg.odds_decimal) })));
        if (!settlement) return null;
        const summary = wagerLegs.map((leg) => `${leg.label}: ${leg.status}${leg.result_note ? ` (${leg.result_note})` : ""}`).join("; ");
        await applySettlement(client, wager, wagerLegs, settlement, summary);
        return { settlement, betId: wager.bet_id };
      });
      if (!settled) continue;
      result.settled += 1;
      if (settled.settlement.status === "won") result.won += 1;
      else if (settled.settlement.status === "lost") result.lost += 1;
      else result.refunded += 1;
      void onBetSettled(owner, settled.betId, "grader");
      void evaluateUser(owner);
    } catch (error) {
      if (!(error instanceof SlipError)) console.warn("Could not settle simulated wager", wagerId, error instanceof Error ? error.message : error);
    }
  }
  return result;
}

export function startSimGradingScheduler(): () => void {
  if (process.env.SIM_AUTO_GRADING === "false") return () => undefined;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await gradeOpenWagers();
      if (result.settled) console.info(`Simulated wagers settled: ${result.settled} (${result.won} won, ${result.lost} lost, ${result.refunded} refunded)`);
    } catch (error) {
      console.warn("Simulated wager grading failed", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  const initial = setTimeout(() => void run(), 20_000);
  const interval = setInterval(() => void run(), GRADING_MINUTES * 60 * 1000);
  initial.unref();
  interval.unref();
  console.info(`Simulated wager grading every ${GRADING_MINUTES} minutes`);
  return () => { clearTimeout(initial); clearInterval(interval); };
}

/* ---------- History and analytics ---------- */

export async function bankrollHistory(userId: number, limit = 200) {
  const [bankroll, transactions, curve] = await Promise.all([
    bankrollOverview(userId),
    pool.query<{ id: string; kind: string; amount: string; balance_after: string; sim_bet_id: string | null; note: string; created_at: Date }>(
      "SELECT id, kind, amount, balance_after, sim_bet_id, note, created_at FROM bankroll_transactions WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2", [userId, Math.min(1000, Math.max(1, limit))],
    ),
    // Settled bankroll by day: the starting bankroll plus every graded bet (simulated and manually tracked).
    pool.query<{ day: Date; profit_loss: string; bets: string }>(
      `SELECT COALESCE(graded_at, bet_date)::date AS day, SUM(profit_loss) AS profit_loss, COUNT(*) AS bets
       FROM bets WHERE user_id=$1 AND result <> 'pending' GROUP BY 1 ORDER BY 1`, [userId],
    ),
  ]);
  let balance = bankroll.startingBankroll;
  return {
    bankroll,
    transactions: transactions.rows.map((row) => ({ id: row.id, kind: row.kind, amount: Number(row.amount), balanceAfter: Number(row.balance_after), wagerId: row.sim_bet_id, note: row.note, createdAt: row.created_at.toISOString() })),
    curve: curve.rows.map((row) => {
      balance = round2(balance + Number(row.profit_loss));
      return { date: row.day.toISOString().slice(0, 10), profitLoss: Number(row.profit_loss), bankroll: balance, bets: Number(row.bets) };
    }),
  };
}

interface GroupRow { label: string; bets: string; wins: string; losses: string; staked: string; profit_loss: string; clv: string | null; ev: string | null }

function groupView(row: GroupRow, unit: number) {
  const staked = Number(row.staked);
  const decisions = Number(row.wins) + Number(row.losses);
  return {
    label: row.label, bets: Number(row.bets), wins: Number(row.wins), losses: Number(row.losses), staked, profitLoss: Number(row.profit_loss),
    roi: staked > 0 ? Number(row.profit_loss) / staked * 100 : 0, winRate: decisions ? Number(row.wins) / decisions * 100 : 0, units: Number(row.profit_loss) / unit,
    avgClv: numberOrNull(row.clv), avgEv: numberOrNull(row.ev),
  };
}

const GROUP_COLUMNS = `COUNT(*) AS bets, COUNT(*) FILTER (WHERE s.status='won') AS wins, COUNT(*) FILTER (WHERE s.status='lost') AS losses,
  COALESCE(SUM(s.stake),0) AS staked, COALESCE(SUM(s.profit_loss),0) AS profit_loss, AVG(s.clv_pct) AS clv, AVG(s.ev_pct) AS ev`;
const SETTLED = "s.user_id=$1 AND s.status IN ('won','lost','push')";

export async function simAnalytics(userId: number) {
  const bankroll = await bankrollOverview(userId);
  const group = async (label: string, extra = "", from = "simulated_bets s") =>
    (await pool.query<GroupRow>(`SELECT ${label} AS label, ${GROUP_COLUMNS} FROM ${from} WHERE ${SETTLED} ${extra} GROUP BY 1 ORDER BY SUM(s.profit_loss) DESC`, [userId]))
      .rows.map((row) => groupView(row, bankroll.unitSize));
  const [totals, bySport, byConference, byBetType, byBook, ncaaMarkets, ncaaVenue, curve] = await Promise.all([
    pool.query<GroupRow>(`SELECT 'all' AS label, ${GROUP_COLUMNS} FROM simulated_bets s WHERE ${SETTLED}`, [userId]),
    group("UPPER(s.sport)"),
    group("s.conference", "AND s.sport='ncaab' AND s.conference <> ''"),
    group("s.bet_type"),
    group("s.sportsbook"),
    // NCAA singles by market and by period (full game vs halves).
    group("l.market_type || CASE WHEN l.period = 'game' THEN '' ELSE ' (' || l.period || ')' END", "AND s.sport='ncaab' AND s.bet_type NOT IN ('parlay','sgp')", "simulated_bets s JOIN simulated_bet_legs l ON l.sim_bet_id = s.id"),
    // NCAA sides: was the pick the home team, the road team, or not a side at all?
    group("CASE WHEN l.selection = l.home_team THEN 'Home team' WHEN l.selection = l.away_team THEN 'Road team' WHEN l.selection ILIKE 'over%' THEN 'Over' WHEN l.selection ILIKE 'under%' THEN 'Under' ELSE 'Other' END",
      "AND s.sport='ncaab' AND s.bet_type IN ('moneyline','spread','total')", "simulated_bets s JOIN simulated_bet_legs l ON l.sim_bet_id = s.id"),
    pool.query<{ day: Date; profit_loss: string; staked: string; bets: string }>(
      `SELECT s.settled_at::date AS day, SUM(s.profit_loss) AS profit_loss, SUM(s.stake) AS staked, COUNT(*) AS bets FROM simulated_bets s WHERE ${SETTLED} GROUP BY 1 ORDER BY 1`, [userId],
    ),
  ]);
  let cumulative = 0;
  return {
    bankroll,
    totals: groupView(totals.rows[0]!, bankroll.unitSize),
    bySport,
    byConference,
    byBetType: byBetType.map((row) => ({ ...row, label: BET_TYPE_LABEL[row.label as BetType] ?? row.label })),
    byBook,
    ncaa: { markets: ncaaMarkets, sides: ncaaVenue, conferences: byConference, totals: bySport.find((row) => row.label === "NCAAB") ?? null },
    /** Cumulative simulated profit by settlement day (the bankroll curve is in /api/bankroll/history). */
    profitCurve: curve.rows.map((row) => {
      cumulative = round2(cumulative + Number(row.profit_loss));
      return { date: row.day.toISOString().slice(0, 10), profitLoss: Number(row.profit_loss), cumulative, staked: Number(row.staked), bets: Number(row.bets) };
    }),
  };
}
