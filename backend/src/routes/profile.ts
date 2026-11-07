import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import type { AuthRequest } from "../types";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const result = await pool.query("SELECT id, username, email, created_at FROM users WHERE id=$1", [req.user!.id]);
    res.json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res, next) => {
  try {
    const data = z.object({ username: z.string().trim().min(2).max(40) }).parse(req.body);
    const result = await pool.query("UPDATE users SET username=$1 WHERE id=$2 RETURNING id, username, email, created_at", [data.username, req.user!.id]);
    res.json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
