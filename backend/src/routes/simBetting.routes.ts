import { Router, type NextFunction, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { ODDS_SPORTS, type OddsSport } from "../services/oddsCatalog";
import {
  gradeOpenWagers, listOpenWagers, listWagerHistory, MAX_SLIP_WAGERS, placeSlip, quoteSlip, settleWagerManually, simAnalytics, SlipError, voidWager,
} from "../services/simBetting.service";
import type { AuthRequest } from "../types";

/**
 * Simulated betting: bet slips, open wagers and analytics. Nothing here moves real money or talks
 * to a sportsbook; stakes are reserved against the user's simulated bankroll.
 */

const american = z.coerce.number().int().refine((value) => Math.abs(value) >= 100 && Math.abs(value) <= 100000, "Invalid odds");
const stake = z.coerce.number().finite().gt(0).max(1_000_000).optional();
const legSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("market"),
    sport: z.enum(ODDS_SPORTS as [OddsSport, ...OddsSport[]]),
    gameId: z.string().trim().min(1).max(100),
    selectionId: z.string().trim().min(3).max(600),
    book: z.string().trim().regex(/^[a-z0-9_]{2,40}$/),
    american,
    stake,
  }),
  z.object({ kind: z.literal("future"), marketId: z.string().trim().regex(/^\d{1,12}$/), outcome: z.string().trim().min(1).max(120), american, stake }),
]);
const slipSchema = z.object({
  mode: z.enum(["single", "parlay"]),
  legs: z.array(legSchema).min(1).max(MAX_SLIP_WAGERS),
  stake,
  acceptOddsChanges: z.boolean().optional(),
});
const wagerId = z.string().regex(/^\d{1,18}$/, "Invalid wager ID");

function fail(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof SlipError) {
    res.status(error.status).json({ error: error.message, ...(error.details ? { details: error.details } : {}) });
    return;
  }
  next(error);
}

const placeLimit = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String((req as AuthRequest).user?.id ?? req.ip), message: { error: "Too many bet slips. Wait a moment and try again." } });
const gradeLimit = rateLimit({ windowMs: 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String((req as AuthRequest).user?.id ?? req.ip), message: { error: "Grading runs automatically every few minutes. Try again shortly." } });

export const betSlipRouter = Router();
betSlipRouter.use(requireAuth);
/** Review step: current prices, payout, EV and risk without placing anything. */
betSlipRouter.post("/quote", async (req: AuthRequest, res, next) => {
  try {
    res.json(await quoteSlip(req.user!.id, slipSchema.parse(req.body)));
  } catch (error) { fail(error, res, next); }
});
betSlipRouter.post("/", placeLimit, async (req: AuthRequest, res, next) => {
  try {
    res.status(201).json(await placeSlip(req.user!.id, slipSchema.parse(req.body)));
  } catch (error) { fail(error, res, next); }
});

export const openBetsRouter = Router();
openBetsRouter.use(requireAuth);
openBetsRouter.get("/", async (req: AuthRequest, res, next) => {
  try {
    res.json(await listOpenWagers(req.user!.id));
  } catch (error) { fail(error, res, next); }
});
openBetsRouter.post("/grade", gradeLimit, async (req: AuthRequest, res, next) => {
  try {
    res.json(await gradeOpenWagers(req.user!.id));
  } catch (error) { fail(error, res, next); }
});
openBetsRouter.post("/:id/void", async (req: AuthRequest, res, next) => {
  try {
    res.json({ bankroll: await voidWager(req.user!.id, wagerId.parse(req.params.id)) });
  } catch (error) { fail(error, res, next); }
});
openBetsRouter.post("/:id/settle", async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ result: z.enum(["won", "lost", "push"]) }).parse(req.body);
    res.json({ bankroll: await settleWagerManually(req.user!.id, wagerId.parse(req.params.id), body.result) });
  } catch (error) { fail(error, res, next); }
});

export const simRouter = Router();
simRouter.use(requireAuth);
simRouter.get("/bets", async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({
      status: z.enum(["open", "settled", "won", "lost", "push", "void"]).optional(),
      sport: z.enum(ODDS_SPORTS as [OddsSport, ...OddsSport[]]).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }).parse(req.query);
    res.json(await listWagerHistory(req.user!.id, query));
  } catch (error) { fail(error, res, next); }
});
simRouter.get("/analytics", async (req: AuthRequest, res, next) => {
  try {
    res.json(await simAnalytics(req.user!.id));
  } catch (error) { fail(error, res, next); }
});
