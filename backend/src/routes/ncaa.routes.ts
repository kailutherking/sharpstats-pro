import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { StatsProviderError } from "../providers/espnStats";
import { listLiveGames } from "../services/liveGame.service";
import { getConferenceStandings, getFutures, getNcaaPlayers, getNcaaStats, getNcaaTeams, getRankings } from "../services/ncaa.service";
import { STATS_WINDOWS, type StatsWindow } from "../services/stats.service";
import type { AuthRequest } from "../types";

/** NCAA Division I men's basketball. Team and player profiles use /api/stats/{team,player}/:id?league=ncaab. */
const router = Router();
router.use(requireAuth);

const text = (max: number) => z.string().trim().min(1).max(max).optional();
const windowSchema = z.enum(STATS_WINDOWS as [StatsWindow, ...StatsWindow[]]).default("season");
const flag = z.enum(["true", "false"]).optional().transform((value) => value === "true");

function fail(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: error.issues[0]?.message ?? "Invalid query" });
    return;
  }
  if (error instanceof StatsProviderError) {
    console.warn("NCAA provider error", error.message);
    res.status(502).json({ error: "The NCAA data provider is unavailable right now. Try again shortly." });
    return;
  }
  next(error);
}

router.get("/stats", async (req: AuthRequest, res, next) => {
  try {
    res.json(await getNcaaStats(z.object({ conference: text(80), window: windowSchema }).parse(req.query)));
  } catch (error) { fail(error, res, next); }
});

router.get("/players", async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({
      team: text(12), conference: text(80), position: text(8), search: text(60), sort: z.string().regex(/^[a-zA-Z]{1,12}$/).optional(),
      order: z.enum(["asc", "desc"]).optional(), limit: z.coerce.number().int().min(1).max(500).default(50), offset: z.coerce.number().int().min(0).max(20000).default(0), window: windowSchema,
    }).parse(req.query);
    res.json(await getNcaaPlayers(query));
  } catch (error) { fail(error, res, next); }
});

router.get("/teams", async (req: AuthRequest, res, next) => {
  try {
    res.json(await getNcaaTeams(z.object({ conference: text(80), search: text(60), ranked: flag }).parse(req.query)));
  } catch (error) { fail(error, res, next); }
});

router.get("/conferences", async (req: AuthRequest, res, next) => {
  try {
    res.json({ conferences: await getConferenceStandings(z.object({ conference: text(80) }).parse(req.query).conference) });
  } catch (error) { fail(error, res, next); }
});

router.get("/rankings", async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({ poll: z.enum(["ap", "coaches", "net", "kenpom"]).optional(), limit: z.coerce.number().int().min(1).max(400).optional() }).parse(req.query);
    const rankings = await getRankings();
    res.json({
      ...rankings,
      polls: rankings.polls.filter((poll) => !query.poll || poll.key === query.poll).map((poll) => query.limit ? { ...poll, teams: poll.teams.slice(0, query.limit) } : poll),
    });
  } catch (error) { fail(error, res, next); }
});

router.get("/live-games", async (req: AuthRequest, res, next) => {
  try {
    res.json(await listLiveGames("ncaab", { force: false }));
  } catch (error) { fail(error, res, next); }
});

router.get("/futures", async (req: AuthRequest, res, next) => {
  try {
    res.json(await getFutures());
  } catch (error) { fail(error, res, next); }
});

export default router;
