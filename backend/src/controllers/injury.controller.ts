import type { NextFunction, Response } from "express";
import { z } from "zod";
import { INJURY_STATUSES, type InjuryStatus } from "../providers/espnInjuries";
import { LEAGUES, StatsProviderError, type League } from "../providers/espnStats";
import type { AuthRequest } from "../types";
import { getInjuryImpact, getInjuryReport, getPlayerInjury, getTeamInjuries } from "../services/injury.service";
import { NotFoundError } from "../services/stats.service";

const leagueSchema = z.enum(LEAGUES as [League, ...League[]]).default("nba");
const idSchema = z.string().regex(/^\d{1,12}$/, "Invalid ID");
const reportQuery = z.object({
  league: leagueSchema,
  team: idSchema.optional(),
  position: z.string().trim().max(8).optional(),
  status: z.string().optional().transform((value) => value ? value.split(",").filter((item): item is InjuryStatus => (INJURY_STATUSES as readonly string[]).includes(item)) : undefined),
  updated: z.enum(["24h", "3d", "7d", "all"]).default("all"),
  q: z.string().trim().max(60).optional(),
  refresh: z.enum(["true", "false"]).optional(),
});
const impactQuery = z.object({ league: leagueSchema, min: z.coerce.number().int().min(0).max(100).default(30), limit: z.coerce.number().int().min(1).max(60).default(25) });

function handleError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof StatsProviderError) {
    console.warn("Injury provider error", error.message);
    res.status(502).json({ error: "The injury report provider is unavailable right now. Try again shortly." });
    return;
  }
  next(error);
}

const lower = (query: Record<string, unknown>) => ({ ...query, league: typeof query.league === "string" ? query.league.toLowerCase() : query.league });

export async function injuryReport(req: AuthRequest, res: Response, next: NextFunction) {
  const query = reportQuery.safeParse(lower(req.query));
  if (!query.success) {
    res.status(400).json({ error: "Invalid filters. Use league=nba|nfl|mlb|nhl." });
    return;
  }
  const { league, refresh, ...filters } = query.data;
  try {
    res.json(await getInjuryReport(league, filters, { force: refresh === "true" }));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function playerInjury(req: AuthRequest, res: Response, next: NextFunction) {
  const league = leagueSchema.safeParse(lower(req.query).league);
  const id = idSchema.safeParse(req.params.id);
  if (!league.success || !id.success) {
    res.status(400).json({ error: "Provide a player ID and league." });
    return;
  }
  try {
    res.json(await getPlayerInjury(league.data, id.data));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function teamInjuries(req: AuthRequest, res: Response, next: NextFunction) {
  const league = leagueSchema.safeParse(lower(req.query).league);
  const id = idSchema.safeParse(req.params.id);
  if (!league.success || !id.success) {
    res.status(400).json({ error: "Provide a team ID and league." });
    return;
  }
  try {
    res.json(await getTeamInjuries(league.data, id.data));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function injuryImpact(req: AuthRequest, res: Response, next: NextFunction) {
  const query = impactQuery.safeParse(lower(req.query));
  if (!query.success) {
    res.status(400).json({ error: "Invalid parameters. Use league, min (0-100) and limit (1-60)." });
    return;
  }
  try {
    res.json(await getInjuryImpact(query.data.league, { minImportance: query.data.min, limit: query.data.limit }));
  } catch (error) {
    handleError(error, res, next);
  }
}
