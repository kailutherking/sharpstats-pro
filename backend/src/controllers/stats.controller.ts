import type { NextFunction, Response } from "express";
import { z } from "zod";
import { LEAGUES, StatsProviderError, type League } from "../providers/espnStats";
import type { AuthRequest } from "../types";
import {
  getLeagueStats, getPlayerProfile, getTeamProfile, listFavorites, NotFoundError, setFavorite, STATS_WINDOWS, type StatsWindow,
} from "../services/stats.service";

const leagueSchema = z.enum(LEAGUES as [League, ...League[]]);
const windowSchema = z.enum(STATS_WINDOWS as [StatsWindow, ...StatsWindow[]]).default("season");
const idSchema = z.string().regex(/^\d{1,12}$/, "Invalid ID");
const favoriteSchema = z.object({
  league: leagueSchema,
  entityType: z.enum(["player", "team"]),
  entityId: idSchema,
  name: z.string().trim().min(1).max(120),
  teamAbbr: z.string().trim().max(12).default(""),
  imageUrl: z.string().url().max(500).startsWith("https://").nullable().optional(),
  favorite: z.boolean(),
});

function handleError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof StatsProviderError) {
    console.warn("Stats provider error", error.message);
    res.status(502).json({ error: "The stats provider is unavailable right now. Try again shortly." });
    return;
  }
  next(error);
}

function parseLeague(value: unknown, res: Response): League | null {
  const parsed = leagueSchema.safeParse(typeof value === "string" ? value.toLowerCase() : value);
  if (!parsed.success) {
    res.status(404).json({ error: "Unsupported league. Use nba, nfl, mlb or nhl." });
    return null;
  }
  return parsed.data;
}

function parseWindow(value: unknown, res: Response): StatsWindow | null {
  const parsed = windowSchema.safeParse(value);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid window. Use season, last10 or last30." });
    return null;
  }
  return parsed.data;
}

export async function leagueStats(req: AuthRequest, res: Response, next: NextFunction) {
  const league = parseLeague(req.params.league, res);
  const window = league && parseWindow(req.query.window, res);
  if (!league || !window) return;
  try {
    res.json(await getLeagueStats(league, window, { force: req.query.refresh === "true" }));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function refreshLeague(req: AuthRequest, res: Response, next: NextFunction) {
  const league = parseLeague(req.params.league, res);
  const window = league && parseWindow(req.query.window ?? req.body?.window, res);
  if (!league || !window) return;
  try {
    res.json(await getLeagueStats(league, window, { force: true }));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function playerProfile(req: AuthRequest, res: Response, next: NextFunction) {
  const league = parseLeague(req.query.league, res);
  const window = league && parseWindow(req.query.window, res);
  if (!league || !window) return;
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "Invalid player ID" });
    return;
  }
  try {
    res.json(await getPlayerProfile(league, id.data, window, { force: req.query.refresh === "true" }));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function teamProfile(req: AuthRequest, res: Response, next: NextFunction) {
  const league = parseLeague(req.query.league, res);
  if (!league) return;
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "Invalid team ID" });
    return;
  }
  try {
    res.json(await getTeamProfile(league, id.data, { force: req.query.refresh === "true" }));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function favorites(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ favorites: await listFavorites(req.user!.id) });
  } catch (error) {
    next(error);
  }
}

export async function updateFavorite(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const body = favoriteSchema.parse(req.body);
    const favorite = await setFavorite(req.user!.id, {
      league: body.league,
      entity_type: body.entityType,
      entity_id: body.entityId,
      name: body.name,
      team_abbr: body.teamAbbr,
      image_url: body.imageUrl ?? null,
    }, body.favorite);
    res.json({ favorite });
  } catch (error) {
    next(error);
  }
}
