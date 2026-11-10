import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth";
import { injuryImpact, injuryReport, playerInjury, teamInjuries } from "../controllers/injury.controller";

const router = Router();
router.use(requireAuth);

const refreshLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.query.refresh !== "true",
  message: { error: "Injury refresh limit reached. Wait a minute before refreshing again." },
});

router.get("/", refreshLimit, injuryReport);
router.get("/impact", injuryImpact);
router.get("/player/:id", playerInjury);
router.get("/team/:id", teamInjuries);

export default router;
