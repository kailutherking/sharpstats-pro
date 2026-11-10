import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth";
import { liveGame, liveGames, livePlayer } from "../controllers/liveGame.controller";

const router = Router();
router.use(requireAuth);

/** Forced refreshes skip the 10-second cache and call ESPN directly, so they are rate limited. */
const refreshLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.query.refresh !== "true",
  message: { error: "Live refresh limit reached. The tracker still updates every 15 seconds." },
});

router.get("/", refreshLimit, liveGames);
router.get("/player/:id", livePlayer);
router.get("/:id", refreshLimit, liveGame);

export default router;
