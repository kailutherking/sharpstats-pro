import type { NextFunction, Response } from "express";
import { z } from "zod";
import { LEAGUES, StatsProviderError, type League } from "../providers/espnStats";
import type { AuthRequest } from "../types";
import { getLiveGame, getLivePlayer, listLiveGames } from "../services/liveGame.service";
import { NotFoundError } from "../services/stats.service";

const leagueSchema = z.enum(LEAGUES as [League, ...League[]]).default("nba");
const idSchema = z.string().regex(/^\d{1,14}$/, "Invalid ID");
const playerQuery = z.object({
  league: leagueSchema,
  gameId: idSchema,
  stat: z.string().regex(/^[a-zA-Z]{1,24}$/).optional(),
  line: z.coerce.number().min(0).max(1000).optional(),
});

function handleError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof StatsProviderError) {
    console.warn("Live provider error", error.message);
    res.status(error.status === 404 ? 404 : 502).json({ error: error.status === 404 ? "Game not found" : "The live game provider is unavailable right now. Try again shortly." });
    return;
  }
  next(error);
}

function league(value: unknown, res: Response): League | null {
  const parsed = leagueSchema.safeParse(typeof value === "string" ? value.toLowerCase() : value);
  if (!parsed.success) {
    res.status(400).json({ error: "Unsupported league. Use nba, nfl, mlb, nhl or ncaab." });
    return null;
  }
  return parsed.data;
}

export async function liveGames(req: AuthRequest, res: Response, next: NextFunction) {
  const sport = league(req.query.league, res);
  if (!sport) return;
  try {
    res.json(await listLiveGames(sport, { force: req.query.refresh === "true" }));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function liveGame(req: AuthRequest, res: Response, next: NextFunction) {
  const sport = league(req.query.league, res);
  if (!sport) return;
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "Invalid game ID" });
    return;
  }
  try {
    res.json(await getLiveGame(sport, id.data, { force: req.query.refresh === "true" }));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function livePlayer(req: AuthRequest, res: Response, next: NextFunction) {
  const id = idSchema.safeParse(req.params.id);
  const query = playerQuery.safeParse({ ...req.query, league: typeof req.query.league === "string" ? req.query.league.toLowerCase() : req.query.league });
  if (!id.success || !query.success) {
    res.status(400).json({ error: "Provide a player ID, league and gameId (optional stat and line)." });
    return;
  }
  try {
    res.json(await getLivePlayer(query.data.league, query.data.gameId, id.data, { stat: query.data.stat, line: query.data.line }));
  } catch (error) {
    handleError(error, res, next);
  }
}
