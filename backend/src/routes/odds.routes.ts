import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth";
import { oddsController } from "../controllers/odds.controller";

const router = Router();
router.use(requireAuth);

/** Manual refreshes always hit the provider, so they are limited per client. */
const refreshLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Refresh limit reached. Odds update automatically every 30 seconds." },
});

/** Per-game and prop requests can trigger priced provider calls on a cache miss. */
const onDemandLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many market requests. Wait a moment and try again." },
});

router.get("/stream", oddsController.stream);
router.get("/live", oddsController.live);
router.get("/movement", oddsController.movement);
router.get("/history", oddsController.history);
router.get("/arbitrage", oddsController.arbitrage);
router.get("/ev", oddsController.ev);
router.get("/player-props", onDemandLimit, oddsController.playerProps);
router.get("/sportsbooks", oddsController.sportsbooks);
router.get("/status", oddsController.status);
router.get("/search", oddsController.search);
router.get("/alerts", oddsController.alerts);
router.post("/alerts/rules", oddsController.createRule);
router.patch("/alerts/rules/:id", oddsController.updateRule);
router.delete("/alerts/rules/:id", oddsController.deleteRule);
router.get("/favorites", oddsController.favorites);
router.put("/favorites", oddsController.setFavorite);
router.get("/clv", oddsController.clv);
router.get("/game/:id", onDemandLimit, oddsController.game);
router.post("/refresh", refreshLimit, oddsController.refresh);
router.get("/", oddsController.board);

export default router;
