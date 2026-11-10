import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth";
import { liveGame, liveGames, livePlayer } from "../controllers/liveGame.controller";
import { z } from "zod";
import { LEAGUES, type League } from "../providers/espnStats";
import type { AuthRequest } from "../types";
import { deleteChat, EmptyMessageError, gameChat, LIVE_REACTIONS, postChat, reactLive } from "../services/social/liveChat.service";
import { myLiveBets } from "../services/social/liveBetTracker.service";

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

const leagueSchema = z.enum(LEAGUES as [League, ...League[]]);
const eventId = z.string().regex(/^\d{1,14}$/);
const chatLimit = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String((req as AuthRequest).user?.id ?? req.ip), message: { error: "You're chatting fast. Wait a few seconds." } });
const reactLimit = rateLimit({ windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String((req as AuthRequest).user?.id ?? req.ip), message: { error: "Too many reactions. Try again in a moment." } });

router.get("/:id/chat", async (req: AuthRequest, res, next) => {
  try {
    res.json(await gameChat(req.user!.id, leagueSchema.parse(String(req.query.league).toLowerCase()), eventId.parse(req.params.id)));
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Provide league and a game ID." }); return; }
    next(error);
  }
});
router.post("/:id/chat", chatLimit, async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ league: leagueSchema, body: z.string().max(280) }).parse(req.body);
    res.status(201).json({ message: await postChat(req.user!.id, body.league, eventId.parse(req.params.id), body.body) });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof EmptyMessageError) { res.status(400).json({ error: error instanceof EmptyMessageError ? error.message : "Messages are up to 280 characters." }); return; }
    next(error);
  }
});
router.post("/:id/reactions", reactLimit, async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ league: leagueSchema, reaction: z.enum(LIVE_REACTIONS), playId: z.string().regex(/^\d{1,40}$/).nullable().optional() }).parse(req.body);
    res.json(await reactLive(req.user!.id, body.league, eventId.parse(req.params.id), body.reaction, body.playId ?? null));
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid reaction." }); return; }
    next(error);
  }
});
router.delete("/chat/:messageId", async (req: AuthRequest, res, next) => {
  try {
    const removed = await deleteChat(req.user!.id, z.coerce.number().int().positive().parse(req.params.messageId));
    res.status(removed ? 204 : 404).end();
  } catch (error) {
    next(error);
  }
});
router.get("/:id/my-bets", async (req: AuthRequest, res, next) => {
  try {
    res.json({ bets: await myLiveBets(req.user!.id, leagueSchema.parse(String(req.query.league).toLowerCase()), eventId.parse(req.params.id)) });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Provide league and a game ID." }); return; }
    next(error);
  }
});
router.get("/:id", refreshLimit, liveGame);

export default router;
