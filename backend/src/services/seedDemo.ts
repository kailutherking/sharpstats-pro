import bcrypt from "bcryptjs";
import { pool } from "../db/pool";

export async function seedDemoAccount(): Promise<void> {
  const email = (process.env.DEMO_EMAIL ?? "demo@sharpstats.pro").toLowerCase();
  const password = process.env.DEMO_PASSWORD ?? "SharpStats123!";
  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO users(username,email,password_hash) VALUES('SharpStats Demo',$1,$2)
       ON CONFLICT(email) DO NOTHING RETURNING id`,
      [email, passwordHash],
    );
    if (inserted.rows[0]) {
      const userId = inserted.rows[0].id as number;
      await client.query("INSERT INTO bankroll(user_id,starting_bankroll,current_bankroll,unit_size) VALUES($1,2500,2638.50,50)", [userId]);
      const examples = [
        ["NBA", "NBA", "Celtics vs. Knicks", "Moneyline", "Celtics", 1.91, 100, "win", "DraftKings", 1.90, "Strong home matchup"],
        ["NFL", "NFL", "Bills vs. Dolphins", "Spread", "Bills -3.5", 1.91, 75, "win", "FanDuel", 1.90, "Closing line moved to -4"],
        ["MLB", "MLB", "Yankees vs. Red Sox", "Moneyline", "Yankees", 1.80, 60, "loss", "BetMGM", 1.85, ""],
        ["NBA", "NBA", "Lakers vs. Suns", "Over/Under", "Over 222.5", 1.95, 50, "win", "Caesars", 2.00, ""],
        ["NHL", "NHL", "Rangers vs. Bruins", "Moneyline", "Rangers", 2.10, 40, "pending", "DraftKings", null, ""],
        ["NFL", "NFL", "Chiefs vs. Ravens", "Spread", "Ravens +3", 1.91, 80, "loss", "ESPN BET", 1.95, ""],
        ["NBA", "NBA", "Bucks vs. Heat", "Player Props", "Giannis 25+ pts", 1.87, 45, "win", "FanDuel", 1.83, ""],
        ["MLB", "MLB", "Dodgers vs. Padres", "Run Line", "Dodgers -1.5", 2.05, 35, "push", "BetRivers", 2.00, ""],
      ];
      for (const [index, [sport, league, event, type, pick, odds, stake, result, book, close, notes]] of examples.entries()) {
        const profit = result === "win" ? Number(stake) * (Number(odds) - 1) : result === "loss" ? -Number(stake) : 0;
        await client.query(
          `INSERT INTO bets(user_id,sport,league,event,bet_type,team_player,odds,stake,result,profit_loss,sportsbook,bet_date,closing_odds,notes)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW() - ($12 * INTERVAL '1 day'),$13,$14)`,
          [userId, sport, league, event, type, pick, odds, stake, result, profit, book, index * 3 + 1, close, notes],
        );
      }
      await client.query(
        `UPDATE bankroll SET current_bankroll=starting_bankroll +
         (SELECT COALESCE(SUM(profit_loss),0) FROM bets WHERE user_id=$1) WHERE user_id=$1`,
        [userId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
