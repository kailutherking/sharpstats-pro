import { Router, type NextFunction, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import type { AuthRequest } from "../types";
import { LEAGUES, type League } from "../providers/espnStats";
import { NotFoundError } from "../services/stats.service";
import { follow, followList, getMe, getProfile, HandleTakenError, recordVisit, searchProfiles, updateProfile } from "../services/social/profile.service";
import { addComment, AlreadySharedError, createPost, deleteComment, deletePost, getPost, listComments, listPosts, react, REACTIONS, sharePick } from "../services/social/pick.service";
import { getFeed } from "../services/social/feed.service";
import { leaderboard, sportsbookLeaderboard } from "../services/social/leaderboard.service";
import { achievementsFor } from "../services/social/gamification.service";

const router = Router();
router.use(requireAuth);

/** Posting, commenting and reacting are rate limited per user to keep spam out. */
const writeLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String((req as AuthRequest).user?.id ?? req.ip), message: { error: "Slow down a little: too many actions in a minute." } });

const handleSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,30}$/, "Handles are 3–30 letters, numbers or underscores");
const visibility = z.enum(["public", "followers", "private"]).default("public");
const idParam = z.coerce.number().int().positive();

function fail(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof NotFoundError) { res.status(404).json({ error: error.message }); return; }
  if (error instanceof HandleTakenError || error instanceof AlreadySharedError) { res.status(409).json({ error: error.message }); return; }
  if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues[0]?.message ?? "Invalid input" }); return; }
  next(error);
}

const wrap = (handler: (req: AuthRequest, res: Response) => Promise<unknown>) => (req: AuthRequest, res: Response, next: NextFunction) => {
  handler(req, res).catch((error: unknown) => fail(error, res, next));
};

router.get("/me", wrap(async (req, res) => {
  await recordVisit(req.user!.id);
  res.json(await getMe(req.user!.id));
}));

router.put("/me", writeLimit, wrap(async (req, res) => {
  const body = z.object({
    handle: handleSchema.optional(),
    bio: z.string().trim().max(280).optional(),
    avatarUrl: z.string().url().max(500).startsWith("https://").nullable().optional(),
    favoriteSports: z.array(z.enum(LEAGUES as [League, ...League[]])).max(4).optional(),
    isPublic: z.boolean().optional(),
    onboardingDismissed: z.boolean().optional(),
  }).parse(req.body);
  res.json(await updateProfile(req.user!.id, body));
}));

router.get("/achievements", wrap(async (req, res) => { res.json(await achievementsFor(req.user!.id)); }));

router.get("/profiles/search", wrap(async (req, res) => {
  const q = z.string().trim().min(1).max(40).parse(req.query.q);
  res.json({ profiles: await searchProfiles(q) });
}));
router.get("/profiles/:handle", wrap(async (req, res) => { res.json(await getProfile(req.user!.id, handleSchema.parse(req.params.handle))); }));
router.get("/profiles/:handle/:direction(followers|following)", wrap(async (req, res) => {
  res.json({ profiles: await followList(req.user!.id, handleSchema.parse(req.params.handle), req.params.direction as "followers" | "following") });
}));
router.put("/follows/:handle", writeLimit, wrap(async (req, res) => {
  const { following } = z.object({ following: z.boolean() }).parse(req.body);
  res.json(await follow(req.user!.id, handleSchema.parse(req.params.handle), following));
}));

router.get("/feed", wrap(async (req, res) => {
  const query = z.object({
    scope: z.enum(["following", "all"]).default("all"),
    filter: z.enum(["all", "picks", "wins", "news", "injuries", "market"]).default("all"),
    league: z.enum(LEAGUES as [League, ...League[]]).optional(),
  }).parse(req.query);
  res.json({ items: await getFeed(req.user!.id, query) });
}));

router.get("/picks", wrap(async (req, res) => {
  const query = z.object({ sort: z.enum(["recent", "popular", "tailed", "props", "winners", "sharp"]).default("popular"), scope: z.enum(["following", "all"]).default("all") }).parse(req.query);
  res.json({ picks: await listPosts(req.user!.id, { kind: "pick", sort: query.sort, scope: query.scope, limit: 40 }) });
}));
router.get("/picks/shared-bets", wrap(async (req, res) => {
  const rows = await pool.query<{ bet_id: number; id: string }>("SELECT bet_id, id FROM posts WHERE user_id=$1 AND bet_id IS NOT NULL", [req.user!.id]);
  res.json({ shared: Object.fromEntries(rows.rows.map((row) => [row.bet_id, Number(row.id)])) });
}));
router.post("/picks", writeLimit, wrap(async (req, res) => {
  const body = z.object({ betId: z.number().int().positive(), body: z.string().trim().max(500).default(""), visibility }).parse(req.body);
  res.status(201).json({ post: await sharePick(req.user!.id, body.betId, body) });
}));
router.post("/posts", writeLimit, wrap(async (req, res) => {
  const body = z.object({ body: z.string().trim().min(1).max(500), visibility }).parse(req.body);
  res.status(201).json({ post: await createPost(req.user!.id, body) });
}));
router.get("/posts/:id", wrap(async (req, res) => { res.json({ post: await getPost(req.user!.id, idParam.parse(req.params.id)) }); }));
router.delete("/posts/:id", writeLimit, wrap(async (req, res) => {
  if (!await deletePost(req.user!.id, idParam.parse(req.params.id))) throw new NotFoundError("Post not found");
  res.status(204).end();
}));
router.put("/posts/:id/reactions", writeLimit, wrap(async (req, res) => {
  const body = z.object({ reaction: z.enum(REACTIONS), enabled: z.boolean() }).parse(req.body);
  res.json({ post: await react(req.user!.id, idParam.parse(req.params.id), body.reaction, body.enabled) });
}));
router.get("/posts/:id/comments", wrap(async (req, res) => { res.json({ comments: await listComments(req.user!.id, idParam.parse(req.params.id)) }); }));
router.post("/posts/:id/comments", writeLimit, wrap(async (req, res) => {
  const body = z.object({ body: z.string().trim().min(1).max(500) }).parse(req.body);
  res.status(201).json({ comment: await addComment(req.user!.id, idParam.parse(req.params.id), body.body) });
}));
router.delete("/comments/:id", writeLimit, wrap(async (req, res) => {
  if (!await deleteComment(req.user!.id, idParam.parse(req.params.id))) throw new NotFoundError("Comment not found");
  res.status(204).end();
}));

router.get("/leaderboards", wrap(async (req, res) => {
  const query = z.object({ metric: z.enum(["roi", "winrate", "units", "props"]).default("units"), period: z.enum(["7d", "30d", "all"]).default("30d"), scope: z.enum(["global", "following"]).default("global") }).parse(req.query);
  res.json({ ...query, ...(await leaderboard(req.user!.id, query)) });
}));
router.get("/leaderboards/sportsbooks", wrap(async (req, res) => {
  const period = z.enum(["7d", "30d", "all"]).default("30d").parse(req.query.period);
  res.json({ period, books: await sportsbookLeaderboard(period) });
}));

export default router;
