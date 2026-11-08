import type { NextFunction, Response } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import type { AuthRequest } from "../types";
import { OddsProviderError } from "../providers/theOddsApi";
import { ODDS_SPORTS, type OddsSport } from "../services/oddsCatalog";
import { ALERT_TYPES, createRule, deleteRule, listAlerts, updateRule } from "../services/oddsAlerts.service";
import { openStream } from "../services/oddsStream";
import {
  forceRefresh, getArbitrage, getBoard, getClv, getEv, getGame, getHistory, getLive, getMovement, getPlayerProps, getSportsbooks,
  listOddsFavorites, markDemand, providerStatus, search, setOddsFavorite, sizing,
} from "../services/odds.service";

const sport = z.enum(ODDS_SPORTS as [OddsSport, ...OddsSport[]]).default("nba");
const flag = z.enum(["true", "false"]).optional().transform((value) => value === undefined ? undefined : value === "true");
const key = z.string().regex(/^[a-z0-9_]{2,60}$/);
const gameId = z.string().regex(/^[A-Za-z0-9_-]{3,100}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const tzOffset = z.coerce.number().int().min(-840).max(840).optional();
const category = z.enum(["all", "game", "period", "team", "alternate", "prop"]).optional();

const boardQuery = z.object({
  sport, category, market: key.optional(), book: key.optional(), date: date.optional(), tzOffset,
  q: z.string().trim().max(80).optional(), evOnly: flag, arbOnly: flag, live: flag, pregame: flag,
  gameId: gameId.optional(), limit: z.coerce.number().int().min(1).max(4000).optional(),
});
const movementQuery = z.object({ sport, gameId: gameId.optional(), market: key.optional(), hours: z.coerce.number().int().min(1).max(168).default(24) });
const historyQuery = z.object({ sport, sideId: z.string().min(3).max(400), book: key.optional() });
const evQuery = z.object({ sport, minEv: z.coerce.number().min(-0.5).max(1).default(0.005), category, book: key.optional(), market: key.optional() });
const arbitrageQuery = z.object({ sport, total: z.coerce.number().min(1).max(1_000_000).default(100) });
const propsQuery = z.object({
  sport, gameId: gameId.optional(), market: key.optional(), player: z.string().trim().max(80).optional(), team: z.string().trim().max(80).optional(),
  book: key.optional(), date: date.optional(), tzOffset, type: z.enum(["ou", "yes"]).optional(), research: flag,
});
const gameQuery = z.object({ sport, props: flag, refresh: flag });
const alertsQuery = z.object({
  sport: z.enum(ODDS_SPORTS as [OddsSport, ...OddsSport[]]).optional(),
  types: z.string().optional().transform((value) => value ? value.split(",").filter((item): item is typeof ALERT_TYPES[number] => (ALERT_TYPES as readonly string[]).includes(item)) : undefined),
  hours: z.coerce.number().int().min(1).max(168).default(24),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  mine: flag,
});
const ruleBody = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(ALERT_TYPES),
  sport: z.enum(ODDS_SPORTS as [OddsSport, ...OddsSport[]]).nullable().default(null),
  market: key.nullable().default(null),
  book: key.nullable().default(null),
  query: z.string().trim().max(60).nullable().default(null).transform((value) => value || null),
  minValue: z.coerce.number().min(0).max(100).nullable().default(null),
});
const favoriteBody = z.object({
  kind: z.enum(["market", "prop", "game"]),
  itemKey: z.string().min(1).max(400),
  label: z.string().trim().min(1).max(160),
  sport: z.enum(ODDS_SPORTS as [OddsSport, ...OddsSport[]]),
  favorite: z.boolean(),
});

function invalid(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: error.issues[0]?.message ?? "Invalid request", details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
}

function handle<T>(schema: z.ZodType<T>, source: "query" | "body", run: (input: T, req: AuthRequest, res: Response) => Promise<void>) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(source === "query" ? req.query : req.body);
    if (!parsed.success) {
      invalid(res, parsed.error);
      return;
    }
    try {
      await run(parsed.data, req, res);
    } catch (error) {
      if (error instanceof OddsProviderError) {
        res.status(error.status === 401 || error.status === 503 ? 503 : 502).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
}

async function bankrollOf(userId: number): Promise<number> {
  const result = await pool.query<{ current_bankroll: string }>("SELECT current_bankroll FROM bankroll WHERE user_id=$1", [userId]);
  return Number(result.rows[0]?.current_bankroll ?? 0);
}

export const oddsController = {
  board: handle(boardQuery, "query", async (input, req, res) => {
    const [board, bankroll] = await Promise.all([getBoard(input.sport, input), bankrollOf(req.user!.id)]);
    res.json({ ...board, sizing: sizing(bankroll) });
  }),

  live: handle(z.object({ sport }), "query", async (input, req, res) => {
    const [live, bankroll] = await Promise.all([getLive(input.sport), bankrollOf(req.user!.id)]);
    res.json({ ...live, sizing: sizing(bankroll) });
  }),

  game: handle(gameQuery, "query", async (input, req, res) => {
    const id = gameId.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "Invalid game id" });
      return;
    }
    const [game, bankroll] = await Promise.all([getGame(input.sport, id.data, { props: input.props, force: input.refresh }), bankrollOf(req.user!.id)]);
    if (!game) {
      res.status(404).json({ error: "Game not found in the current odds feed" });
      return;
    }
    res.json({ ...game, sizing: sizing(bankroll) });
  }),

  movement: handle(movementQuery, "query", async (input, _req, res) => {
    res.json(await getMovement(input.sport, input));
  }),

  history: handle(historyQuery, "query", async (input, _req, res) => {
    res.json(await getHistory(input.sport, input.sideId, input.book));
  }),

  ev: handle(evQuery, "query", async (input, req, res) => {
    const [ev, bankroll] = await Promise.all([getEv(input.sport, input), bankrollOf(req.user!.id)]);
    res.json({ ...ev, sizing: sizing(bankroll) });
  }),

  arbitrage: handle(arbitrageQuery, "query", async (input, _req, res) => {
    res.json(await getArbitrage(input.sport, input.total));
  }),

  playerProps: handle(propsQuery, "query", async (input, _req, res) => {
    res.json(await getPlayerProps(input.sport, input));
  }),

  sportsbooks: handle(z.object({}), "query", async (_input, req, res) => {
    res.json(await getSportsbooks(req.user!.id));
  }),

  status: handle(z.object({ sport }), "query", async (input, _req, res) => {
    res.json(providerStatus(input.sport));
  }),

  search: handle(z.object({ q: z.string().trim().min(1).max(80) }), "query", async (input, _req, res) => {
    res.json({ results: search(input.q) });
  }),

  refresh: handle(z.object({ sport }), "query", async (input, req, res) => {
    await forceRefresh(input.sport);
    const [board, bankroll] = await Promise.all([getBoard(input.sport, {}), bankrollOf(req.user!.id)]);
    res.json({ ...board, sizing: sizing(bankroll) });
  }),

  stream: handle(z.object({ sport }), "query", async (input, req, res) => {
    markDemand(input.sport);
    openStream(res, input.sport, req.user!.id, () => markDemand(input.sport));
  }),

  alerts: handle(alertsQuery, "query", async (input, req, res) => {
    res.json(await listAlerts(req.user!.id, input));
  }),

  createRule: handle(ruleBody, "body", async (input, req, res) => {
    const count = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM odds_alert_rules WHERE user_id=$1", [req.user!.id]);
    if (Number(count.rows[0]?.count ?? 0) >= 50) {
      res.status(400).json({ error: "You can keep up to 50 alert rules." });
      return;
    }
    res.status(201).json({ rule: await createRule(req.user!.id, input) });
  }),

  updateRule: handle(z.object({ active: z.boolean() }), "body", async (input, req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid rule id" });
      return;
    }
    const rule = await updateRule(req.user!.id, id, input.active);
    if (!rule) {
      res.status(404).json({ error: "Alert rule not found" });
      return;
    }
    res.json({ rule });
  }),

  deleteRule: handle(z.object({}), "query", async (_input, req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid rule id" });
      return;
    }
    if (!await deleteRule(req.user!.id, id)) {
      res.status(404).json({ error: "Alert rule not found" });
      return;
    }
    res.status(204).end();
  }),

  favorites: handle(z.object({}), "query", async (_input, req, res) => {
    res.json({ favorites: await listOddsFavorites(req.user!.id) });
  }),

  setFavorite: handle(favoriteBody, "body", async (input, req, res) => {
    const { favorite, ...item } = input;
    res.json({ favorite: await setOddsFavorite(req.user!.id, item, favorite) });
  }),

  clv: handle(z.object({}), "query", async (_input, req, res) => {
    res.json(await getClv(req.user!.id));
  }),
};
