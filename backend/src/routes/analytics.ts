import { Router } from "express";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import type { AuthRequest } from "../types";

const router = Router();
router.use(requireAuth);

router.get("/summary", async (req: AuthRequest, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
        COALESCE(SUM(profit_loss) FILTER (WHERE bet_date::date = CURRENT_DATE),0) AS daily_pl,
        COALESCE(SUM(profit_loss) FILTER (WHERE bet_date >= date_trunc('week', CURRENT_DATE)),0) AS weekly_pl,
        COALESCE(SUM(profit_loss) FILTER (WHERE bet_date >= date_trunc('month', CURRENT_DATE)),0) AS monthly_pl,
        COALESCE(SUM(profit_loss),0) AS total_pl,
        COALESCE(SUM(stake) FILTER (WHERE result != 'pending'),0) AS settled_stake,
        COALESCE(COUNT(*) FILTER (WHERE result = 'win'),0) AS wins,
        COALESCE(COUNT(*) FILTER (WHERE result IN ('win','loss')),0) AS decisions,
        COALESCE(COUNT(*) FILTER (WHERE result = 'pending'),0) AS active_bets,
        COALESCE(AVG(odds),0) AS average_odds,
        COALESCE(AVG((odds / closing_odds - 1) * 100) FILTER (WHERE closing_odds IS NOT NULL),0) AS clv_pct,
        COALESCE(SUM(stake) FILTER (WHERE result = 'pending'),0) AS risk_exposure
       FROM bets WHERE user_id = $1`,
      [req.user!.id],
    );
    const bankroll = await pool.query("SELECT starting_bankroll, current_bankroll, unit_size FROM bankroll WHERE user_id=$1", [req.user!.id]);
    const metrics = result.rows[0];
    res.json({
      ...metrics,
      roi: Number(metrics.settled_stake) ? Number(metrics.total_pl) / Number(metrics.settled_stake) * 100 : 0,
      win_rate: Number(metrics.decisions) ? Number(metrics.wins) / Number(metrics.decisions) * 100 : 0,
      bankroll: bankroll.rows[0] ?? { starting_bankroll: 1000, current_bankroll: 1000, unit_size: 25 },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/performance", async (req: AuthRequest, res, next) => {
  try {
    const bySport = await pool.query(
      `SELECT sport AS name, COUNT(*) FILTER (WHERE result IN ('win','loss')) AS decisions,
        COUNT(*) FILTER (WHERE result='win') AS wins, SUM(profit_loss) AS profit_loss
       FROM bets WHERE user_id=$1 AND result != 'pending' GROUP BY sport ORDER BY SUM(profit_loss) DESC`,
      [req.user!.id],
    );
    const byBook = await pool.query(
      `SELECT sportsbook AS name, COUNT(*) FILTER (WHERE result IN ('win','loss')) AS decisions,
        COUNT(*) FILTER (WHERE result='win') AS wins, SUM(profit_loss) AS profit_loss
       FROM bets WHERE user_id=$1 AND result != 'pending' GROUP BY sportsbook ORDER BY SUM(profit_loss) DESC`,
      [req.user!.id],
    );
    const monthly = await pool.query(
      `SELECT TO_CHAR(date_trunc('month', bet_date), 'Mon') AS month,
        SUM(profit_loss) AS profit_loss
       FROM bets WHERE user_id=$1 AND result != 'pending' AND bet_date >= NOW() - INTERVAL '6 months'
       GROUP BY date_trunc('month', bet_date) ORDER BY date_trunc('month', bet_date)`,
      [req.user!.id],
    );
    const daily = await pool.query(
      `SELECT TO_CHAR(date_trunc('day', bet_date), 'Mon DD') AS day,
        SUM(profit_loss) AS profit_loss FROM bets WHERE user_id=$1 AND result != 'pending'
        AND bet_date >= NOW() - INTERVAL '14 days'
        GROUP BY date_trunc('day', bet_date) ORDER BY date_trunc('day', bet_date)`,
      [req.user!.id],
    );
    const byType = await pool.query(
      `SELECT bet_type AS name, COUNT(*) FILTER (WHERE result IN ('win','loss')) AS decisions,
        COUNT(*) FILTER (WHERE result='win') AS wins, SUM(profit_loss) AS profit_loss
       FROM bets WHERE user_id=$1 AND result != 'pending' GROUP BY bet_type ORDER BY SUM(profit_loss) DESC`,
      [req.user!.id],
    );
    const byLeague = await pool.query(
      `SELECT league AS name, COUNT(*) FILTER (WHERE result IN ('win','loss')) AS decisions,
        COUNT(*) FILTER (WHERE result='win') AS wins, SUM(profit_loss) AS profit_loss
       FROM bets WHERE user_id=$1 AND result != 'pending' AND league <> ''
       GROUP BY league ORDER BY SUM(profit_loss) DESC`,
      [req.user!.id],
    );
    res.json({ bySport: bySport.rows, byBook: byBook.rows, monthly: monthly.rows, daily: daily.rows, byType: byType.rows, byLeague: byLeague.rows });
  } catch (error) {
    next(error);
  }
});

export default router;
