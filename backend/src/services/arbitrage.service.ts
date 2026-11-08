import { pool } from "../db/pool";
import type { ArbitrageOpportunity } from "./odds.aggregate.service";
import type { OddsSport } from "./oddsCatalog";

/**
 * Arbitrage lifecycle: the aggregate step finds opportunities on every refresh; this service keeps
 * them in odds_arbitrage with first/last seen times so the scanner shows how long a window lasted.
 */

const active = new Map<OddsSport, Map<string, { firstSeen: string; peak: number }>>();

export interface ArbitrageWithAge extends ArbitrageOpportunity {
  firstSeenAt: string;
  peakProfitPct: number;
}

/** Splits a total outlay across the legs so every outcome returns the same amount. */
export function arbitrageStakes(opportunity: Pick<ArbitrageOpportunity, "legs">, total: number): Array<{ book: string; label: string; stake: number; payout: number }> {
  return opportunity.legs.map((leg) => {
    const stake = Math.round(total * leg.stakeShare * 100) / 100;
    return { book: leg.book, label: leg.label, stake, payout: Math.round(stake * leg.decimal * 100) / 100 };
  });
}

export async function syncArbitrage(sport: OddsSport, opportunities: ArbitrageOpportunity[], now = new Date()): Promise<{ opened: ArbitrageOpportunity[]; current: ArbitrageWithAge[] }> {
  const known = active.get(sport) ?? new Map<string, { firstSeen: string; peak: number }>();
  const nowIso = now.toISOString();
  const opened = opportunities.filter((item) => !known.has(item.id));
  const next = new Map<string, { firstSeen: string; peak: number }>();
  for (const item of opportunities) {
    const previous = known.get(item.id);
    next.set(item.id, { firstSeen: previous?.firstSeen ?? nowIso, peak: Math.max(previous?.peak ?? 0, item.profitPct) });
  }
  const closed = [...known.keys()].filter((id) => !next.has(id));
  active.set(sport, next);
  try {
    if (opportunities.length) {
      await pool.query(
        `INSERT INTO odds_arbitrage(signature, sport, game_id, market_key, participant, profit_pct, peak_profit_pct, legs, books, first_seen_at, last_seen_at, closed_at)
         SELECT s, $2, g, m, p, pr, pk, l::jsonb, b, f::timestamptz, $3::timestamptz, NULL
         FROM unnest($1::text[], $4::text[], $5::text[], $6::text[], $7::numeric[], $8::numeric[], $9::text[], $10::text[], $11::text[]) AS t(s, g, m, p, pr, pk, l, b, f)
         ON CONFLICT (signature) DO UPDATE SET profit_pct=EXCLUDED.profit_pct,
           peak_profit_pct=GREATEST(odds_arbitrage.peak_profit_pct, EXCLUDED.profit_pct), legs=EXCLUDED.legs,
           last_seen_at=EXCLUDED.last_seen_at, closed_at=NULL`,
        [
          opportunities.map((item) => item.id), sport, nowIso,
          opportunities.map((item) => item.gameId), opportunities.map((item) => item.market), opportunities.map((item) => item.participant),
          opportunities.map((item) => item.profitPct), opportunities.map((item) => next.get(item.id)!.peak),
          opportunities.map((item) => JSON.stringify(item.legs)), opportunities.map((item) => item.books.join(",")),
          opportunities.map((item) => next.get(item.id)!.firstSeen),
        ],
      );
    }
    if (closed.length) {
      await pool.query("UPDATE odds_arbitrage SET closed_at=$2 WHERE signature = ANY($1::text[]) AND closed_at IS NULL", [closed, nowIso]);
    }
  } catch (error) {
    console.warn("Arbitrage history write failed", error instanceof Error ? error.message : error);
  }
  return {
    opened,
    current: opportunities.map((item) => ({ ...item, firstSeenAt: next.get(item.id)!.firstSeen, peakProfitPct: next.get(item.id)!.peak })),
  };
}

export function arbitrageAges(sport: OddsSport): Map<string, { firstSeen: string; peak: number }> {
  return active.get(sport) ?? new Map();
}

export interface ClosedArbitrage {
  signature: string;
  gameId: string;
  market: string;
  participant: string;
  peakProfitPct: number;
  books: string[];
  legs: unknown;
  firstSeenAt: string;
  closedAt: string;
  durationSeconds: number;
}

export async function recentClosedArbitrage(sport: OddsSport, hours = 24, limit = 50): Promise<ClosedArbitrage[]> {
  const result = await pool.query<{ signature: string; game_id: string; market_key: string; participant: string; peak_profit_pct: string; books: string; legs: unknown; first_seen_at: Date; closed_at: Date }>(
    `SELECT signature, game_id, market_key, participant, peak_profit_pct::text, books, legs, first_seen_at, closed_at
     FROM odds_arbitrage WHERE sport=$1 AND closed_at IS NOT NULL AND closed_at > NOW() - make_interval(hours => $2)
     ORDER BY closed_at DESC LIMIT $3`,
    [sport, hours, limit],
  );
  return result.rows.map((row) => ({
    signature: row.signature,
    gameId: row.game_id,
    market: row.market_key,
    participant: row.participant,
    peakProfitPct: Number(row.peak_profit_pct),
    books: row.books ? row.books.split(",") : [],
    legs: row.legs,
    firstSeenAt: row.first_seen_at.toISOString(),
    closedAt: row.closed_at.toISOString(),
    durationSeconds: Math.round((row.closed_at.getTime() - row.first_seen_at.getTime()) / 1000),
  }));
}
