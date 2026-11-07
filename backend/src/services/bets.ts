import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import type { BetRow } from "../types";

export interface CreateBetInput {
  sport: string;
  league: string;
  event: string;
  bet_type: string;
  team_player: string;
  odds: number;
  stake: number;
  result: BetRow["result"];
  sportsbook: string;
  bet_date: string;
  closing_odds: number | null;
  market_key: string;
  selection: string;
  line_value: number | null;
  event_id: string | null;
  notes: string;
}

export function calculateProfitLoss(result: BetRow["result"], odds: number, stake: number): number {
  if (result === "win") return Number((stake * (odds - 1)).toFixed(2));
  if (result === "loss") return -stake;
  return 0;
}

export async function syncBankroll(client: PoolClient, userId: number): Promise<void> {
  await client.query(
    `UPDATE bankroll b SET current_bankroll = GREATEST(0, b.starting_bankroll +
      COALESCE((SELECT SUM(profit_loss) FROM bets WHERE user_id = $1), 0)),
      updated_at = NOW() WHERE b.user_id = $1`,
    [userId],
  );
}

export async function createBet(userId: number, data: CreateBetInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const profitLoss = calculateProfitLoss(data.result, Number(data.odds), Number(data.stake));
    const result = await client.query(
      `INSERT INTO bets (user_id, sport, league, event, bet_type, team_player, odds, stake, result,
       profit_loss, sportsbook, bet_date, closing_odds, market_key, selection, line_value, event_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [userId, data.sport, data.league, data.event, data.bet_type, data.team_player,
        data.odds, data.stake, data.result, profitLoss, data.sportsbook, data.bet_date,
        data.closing_odds, data.market_key, data.selection, data.line_value, data.event_id, data.notes],
    );
    await syncBankroll(client, userId);
    await client.query("COMMIT");
    return result.rows[0] as BetRow;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
