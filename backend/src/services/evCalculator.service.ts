/** Pricing math: odds conversion, no-vig fair probabilities, expected value and Kelly sizing. */

export function americanToDecimal(american: number): number {
  if (!Number.isFinite(american) || american === 0) return NaN;
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export function decimalToAmerican(decimal: number): number {
  if (!Number.isFinite(decimal) || decimal <= 1) return NaN;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

export function impliedProbability(decimal: number): number {
  return decimal > 1 ? 1 / decimal : NaN;
}

export function probabilityToAmerican(probability: number): number | null {
  if (!(probability > 0 && probability < 1)) return null;
  return decimalToAmerican(1 / probability);
}

/** Multiplicative de-vig: scales each side's implied probability so the market sums to 100%. */
export function removeVig(decimals: number[]): number[] | null {
  if (decimals.length < 2 || decimals.some((value) => !(value > 1))) return null;
  const implied = decimals.map((value) => 1 / value);
  const total = implied.reduce((sum, value) => sum + value, 0);
  return total > 0 ? implied.map((value) => value / total) : null;
}

/** Bookmaker margin (overround) of a complete market, e.g. 0.045 for -110/-110. */
export function overround(decimals: number[]): number | null {
  if (decimals.length < 2 || decimals.some((value) => !(value > 1))) return null;
  return decimals.reduce((sum, value) => sum + 1 / value, 0) - 1;
}

export function expectedValue(fairProbability: number, decimal: number): number {
  return fairProbability * decimal - 1;
}

/** Full Kelly fraction of bankroll; 0 when the bet has no edge. */
export function kellyFraction(fairProbability: number, decimal: number): number {
  const b = decimal - 1;
  if (!(b > 0) || !(fairProbability > 0)) return 0;
  return Math.max(0, (b * fairProbability - (1 - fairProbability)) / b);
}

export const KELLY_MULTIPLIER = Math.min(1, Math.max(0.05, Number(process.env.ODDS_KELLY_MULTIPLIER ?? 0.25) || 0.25));
/** Matches the Bankroll page: fractional Kelly capped at 5% of bankroll. */
export const MAX_STAKE_FRACTION = 0.05;

export function recommendedStake(bankroll: number, fullKelly: number): number {
  if (!(bankroll > 0) || !(fullKelly > 0)) return 0;
  return Math.round(bankroll * Math.min(MAX_STAKE_FRACTION, fullKelly * KELLY_MULTIPLIER) * 100) / 100;
}

export type EvTier = "positive" | "strong" | "elite";
export const EV_TIERS = { positive: 0.005, strong: 0.03, elite: 0.06 } as const;

export function evTier(ev: number | null): EvTier | null {
  if (ev === null || !(ev >= EV_TIERS.positive)) return null;
  if (ev >= EV_TIERS.elite) return "elite";
  if (ev >= EV_TIERS.strong) return "strong";
  return "positive";
}

export type RiskRating = "low" | "medium" | "high";

/**
 * How much to trust an edge: thin consensus, long prices, props and very large edges (often a stale
 * line about to move) all raise the risk.
 */
export function riskRating(input: { ev: number; decimal: number; fairBooks: number; isProp: boolean; sharpReference: boolean }): RiskRating {
  let score = 0;
  if (input.fairBooks < 3 && !input.sharpReference) score += 2;
  else if (input.fairBooks < 5 && !input.sharpReference) score += 1;
  if (input.decimal >= 4) score += 2;
  else if (input.decimal >= 2.6) score += 1;
  if (input.isProp) score += 1;
  if (input.ev >= 0.15) score += 2;
  else if (input.ev >= 0.08) score += 1;
  return score >= 4 ? "high" : score >= 2 ? "medium" : "low";
}

export type ConfidenceLabel = "high" | "medium" | "low";
export interface Confidence { score: number; label: ConfidenceLabel; reasons: string[] }

/**
 * How much to trust an EV figure, 0-100. Rewards a sharp reference price and broad agreement between
 * books; penalises thin consensus, props, long odds, implausibly large edges and stale prices.
 */
export function confidenceRating(input: {
  ev: number; decimal: number; fairBooks: number; sharpReference: boolean; isProp: boolean;
  booksAtLine: number; priceAgeSeconds: number | null; steam?: boolean; live?: boolean;
}): Confidence {
  let score = 50;
  const reasons: string[] = [];
  if (input.sharpReference) { score += 25; reasons.push("Sharp reference price"); }
  else if (input.fairBooks >= 5) { score += 20; reasons.push(`${input.fairBooks}-book consensus`); }
  else if (input.fairBooks >= 3) { score += 12; reasons.push(`${input.fairBooks}-book consensus`); }
  else { score += 2; reasons.push("Thin consensus"); }
  if (input.booksAtLine >= 5) score += 10;
  else if (input.booksAtLine >= 3) score += 5;
  if (input.isProp) { score -= 10; reasons.push("Player prop"); }
  if (input.decimal >= 4) { score -= 15; reasons.push("Long odds"); }
  else if (input.decimal >= 2.6) score -= 7;
  if (input.ev >= 0.15) { score -= 15; reasons.push("Edge unusually large; check for a stale line"); }
  else if (input.ev >= 0.08) score -= 7;
  if (input.priceAgeSeconds !== null && input.priceAgeSeconds > 3600) { score -= 20; reasons.push("Price not updated for over an hour"); }
  else if (input.priceAgeSeconds !== null && input.priceAgeSeconds > 900) { score -= 10; reasons.push("Price not updated for 15+ minutes"); }
  if (input.live) { score -= 30; reasons.push("In-play: books update at different speeds, so most live gaps are delayed prices"); }
  if (input.steam) { score += 5; reasons.push("Steam on this side"); }
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return { score: clamped, label: clamped >= 70 ? "high" : clamped >= 45 ? "medium" : "low", reasons };
}

export function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/* ---------- EV history ---------- */

export interface EvSnapshot {
  sideId: string;
  sport: string;
  gameId: string;
  market: string;
  label: string;
  book: string;
  american: number;
  fairProbability: number;
  ev: number;
  kelly: number;
}

const activeEv = new Map<string, Set<string>>();

/**
 * Records +EV prices in odds_ev_history: one open row per (side, book, price) while the edge
 * lasts, with the peak EV, then closes it when the price moves or the edge disappears.
 * Returns the keys of prices that became +EV in this snapshot.
 */
export async function syncEvHistory(sport: string, snapshot: EvSnapshot[], now = new Date()): Promise<Set<string>> {
  const { pool } = await import("../db/pool");
  const keyOf = (row: EvSnapshot) => `${row.sideId}|${row.book}|${row.american}`;
  const rows = [...new Map(snapshot.map((row) => [keyOf(row), row])).values()];
  const previous = activeEv.get(sport) ?? new Set<string>();
  const current = new Set(rows.map(keyOf));
  const opened = new Set([...current].filter((key) => !previous.has(key)));
  const closed = [...previous].filter((key) => !current.has(key));
  activeEv.set(sport, current);
  const nowIso = now.toISOString();
  try {
    if (rows.length) {
      await pool.query(
        `INSERT INTO odds_ev_history(side_id, book_key, price_american, sport, game_id, market_key, label, fair_probability, ev, peak_ev, kelly, first_seen_at, last_seen_at)
         SELECT s, b, p, $1, g, m, l, f, e, e, k, $2::timestamptz, $2::timestamptz
         FROM unnest($3::text[], $4::text[], $5::int[], $6::text[], $7::text[], $8::text[], $9::numeric[], $10::numeric[], $11::numeric[]) AS t(s, b, p, g, m, l, f, e, k)
         ON CONFLICT (side_id, book_key, price_american) WHERE closed_at IS NULL
         DO UPDATE SET fair_probability=EXCLUDED.fair_probability, ev=EXCLUDED.ev, kelly=EXCLUDED.kelly,
           peak_ev=GREATEST(odds_ev_history.peak_ev, EXCLUDED.ev), last_seen_at=EXCLUDED.last_seen_at`,
        [
          sport, nowIso,
          rows.map((row) => row.sideId), rows.map((row) => row.book), rows.map((row) => row.american),
          rows.map((row) => row.gameId), rows.map((row) => row.market), rows.map((row) => row.label),
          rows.map((row) => row.fairProbability), rows.map((row) => row.ev), rows.map((row) => row.kelly),
        ],
      );
    }
    if (closed.length) {
      const parts = closed.map((key) => {
        const index = key.lastIndexOf("|");
        const bookIndex = key.lastIndexOf("|", index - 1);
        return { sideId: key.slice(0, bookIndex), book: key.slice(bookIndex + 1, index), american: Number(key.slice(index + 1)) };
      });
      await pool.query(
        `UPDATE odds_ev_history h SET closed_at=$4::timestamptz
         FROM unnest($1::text[], $2::text[], $3::int[]) AS t(s, b, p)
         WHERE h.side_id=t.s AND h.book_key=t.b AND h.price_american=t.p AND h.closed_at IS NULL`,
        [parts.map((part) => part.sideId), parts.map((part) => part.book), parts.map((part) => part.american), nowIso],
      );
    }
  } catch (error) {
    console.warn("EV history write failed", error instanceof Error ? error.message : error);
  }
  return opened;
}

export interface EvHistoryRow {
  sideId: string;
  book: string;
  american: number;
  gameId: string;
  market: string;
  label: string;
  peakEv: number;
  firstSeenAt: string;
  closedAt: string | null;
  durationSeconds: number;
}

export async function recentEvHistory(sport: string, hours = 24, limit = 100): Promise<EvHistoryRow[]> {
  const { pool } = await import("../db/pool");
  const result = await pool.query<{ side_id: string; book_key: string; price_american: number; game_id: string; market_key: string; label: string; peak_ev: string; first_seen_at: Date; last_seen_at: Date; closed_at: Date | null }>(
    `SELECT side_id, book_key, price_american, game_id, market_key, label, peak_ev::text, first_seen_at, last_seen_at, closed_at
     FROM odds_ev_history WHERE sport=$1 AND first_seen_at > NOW() - make_interval(hours => $2)
     ORDER BY first_seen_at DESC LIMIT $3`,
    [sport, hours, limit],
  );
  return result.rows.map((row) => ({
    sideId: row.side_id,
    book: row.book_key,
    american: row.price_american,
    gameId: row.game_id,
    market: row.market_key,
    label: row.label,
    peakEv: Number(row.peak_ev),
    firstSeenAt: row.first_seen_at.toISOString(),
    closedAt: row.closed_at?.toISOString() ?? null,
    durationSeconds: Math.round(((row.closed_at ?? row.last_seen_at).getTime() - row.first_seen_at.getTime()) / 1000),
  }));
}
