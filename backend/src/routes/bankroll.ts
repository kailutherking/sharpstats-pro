import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { syncBankroll } from "../services/bets";
import type { AuthRequest } from "../types";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const result = await pool.query("SELECT starting_bankroll, current_bankroll, unit_size, updated_at FROM bankroll WHERE user_id=$1", [req.user!.id]);
    res.json({ bankroll: result.rows[0] ?? null });
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
      await client.query(
        `INSERT INTO bankroll(user_id, starting_bankroll, current_bankroll, unit_size)
         VALUES($1,$2,$2,$3) ON CONFLICT(user_id) DO UPDATE
         SET starting_bankroll=EXCLUDED.starting_bankroll, unit_size=EXCLUDED.unit_size, updated_at=NOW()`,
        [req.user!.id, data.starting_bankroll, data.unit_size],
      );
      await syncBankroll(client, req.user!.id);
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
