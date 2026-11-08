import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth";
import {
  favorites, leagueStats, playerProfile, refreshLeague, teamProfile, updateFavorite,
} from "../controllers/stats.controller";

const router = Router();
router.use(requireAuth);

/** Manual refreshes bypass the cache and hit the provider, so they are rate limited. */
const refreshLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "GET" && req.query.refresh !== "true",
  message: { error: "Stats refresh limit reached. Wait a minute before refreshing again." },
});

router.get("/favorites", favorites);
router.put("/favorites", updateFavorite);
router.get("/player/:id", refreshLimit, playerProfile);
router.get("/team/:id", refreshLimit, teamProfile);
router.post("/:league/refresh", refreshLimit, refreshLeague);
router.get("/:league", refreshLimit, leagueStats);

export default router;
