import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { syncBankroll } from "../services/bets";
import { bankrollHistory, bankrollOverview, recordAdjustment } from "../services/simBetting.service";
import type { AuthRequest } from "../types";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const result = await pool.query("SELECT starting_bankroll, current_bankroll, unit_size, updated_at FROM bankroll WHERE user_id=$1", [req.user!.id]);
    // `simulation` adds what open simulated wagers have reserved: exposure, available balance and risk.
    res.json({ bankroll: result.rows[0] ?? null, simulation: await bankrollOverview(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

/** Ledger of simulated bankroll movements plus the settled bankroll curve. */
router.get("/history", async (req: AuthRequest, res, next) => {
  try {
    const limit = z.coerce.number().int().min(1).max(1000).default(200).parse(req.query.limit);
    res.json(await bankrollHistory(req.user!.id, limit));
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res, next) => {
  try {
    const data = z.object({
      starting_bankroll: z.coerce.number().min(0).max(100_000_000),
      unit_size: z.coerce.number().gt(0).max(1_000_000),
    }).parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const before = await client.query<{ starting_bankroll: string }>("SELECT starting_bankroll FROM bankroll WHERE user_id=$1 FOR UPDATE", [req.user!.id]);
      await client.query(
        `INSERT INTO bankroll(user_id, starting_bankroll, current_bankroll, unit_size)
         VALUES($1,$2,$2,$3) ON CONFLICT(user_id) DO UPDATE
         SET starting_bankroll=EXCLUDED.starting_bankroll, unit_size=EXCLUDED.unit_size, updated_at=NOW()`,
        [req.user!.id, data.starting_bankroll, data.unit_size],
      );
      await syncBankroll(client, req.user!.id);
      if (before.rows[0]) await recordAdjustment(client, req.user!.id, data.starting_bankroll - Number(before.rows[0].starting_bankroll), "Starting bankroll changed");
      const result = await client.query("SELECT starting_bankroll, current_bankroll, unit_size FROM bankroll WHERE user_id=$1", [req.user!.id]);
      await client.query("COMMIT");
      res.json({ bankroll: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

export default router;
