import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth";
import { getOddsApiLines, type NormalizedOdds } from "../providers/oddsApi";
import { pool } from "../db/pool";
import type { AuthRequest } from "../types";
import { trainOddsCalibration } from "../services/predictionModel";

const router = Router();
router.use(requireAuth);

router.get("/sportsbooks", async (req: AuthRequest, res, next) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.name, s.region, (f.user_id IS NOT NULL) AS favorite
       FROM sportsbooks s LEFT JOIN favorite_sportsbooks f
       ON s.id=f.sportsbook_id AND f.user_id=$1 ORDER BY s.name`,
      [req.user!.id],
    );
    res.json({ sportsbooks: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get("/odds", rateLimit({
  windowMs: 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Market refresh limit reached. Wait a minute before scanning again." },
}), async (req: AuthRequest, res, next) => {
  try {
    const sport = typeof req.query.sport === "string" ? req.query.sport : "basketball_nba";
    const includeProps = req.query.includeProps === "true";
    const rawLines = await getOddsApiLines(sport, includeProps);
    const snapshots = await pool.query<{ event_id: string; market: string; point: string | null; outcome: string; sportsbook: string; decimal_odds: string }>(
      `SELECT DISTINCT ON (event_id, market, point, outcome, sportsbook)
        event_id, market, point::text, outcome, sportsbook, decimal_odds::text
       FROM odds_snapshots WHERE user_id=$1 AND observed_at > NOW() - INTERVAL '24 hours'
       ORDER BY event_id, market, point, outcome, sportsbook, observed_at DESC`,
      [req.user!.id],
    );
    const history = new Map(snapshots.rows.map((item) => [
      `${item.event_id}|${item.market}|${item.point ?? ""}|${item.outcome}|${item.sportsbook}`,
      Number(item.decimal_odds),
    ]));
    const calibration = await trainOddsCalibration(req.user!.id);
    const markets = new Map<string, NormalizedOdds[]>();
    for (const line of rawLines) {
      const propPlayer = line.market.startsWith("player_")
        ? line.outcome.replace(/\s+(over|under)$/i, "").trim()
        : "";
      const key = `${line.eventId}|${line.market}|${Math.abs(line.point ?? 0)}|${propPlayer}`;
      markets.set(key, [...(markets.get(key) ?? []), line]);
    }
    const probabilities = new Map<string, { fairProbability: number; bookCount: number }>();
    const arbitrage: { event: string; market: string; point: number | null; overround: number; legs: { outcome: string; sportsbook: string; odds: number; stakeFraction: number }[] }[] = [];
    for (const group of markets.values()) {
      const books = new Map<string, NormalizedOdds[]>();
      for (const line of group) books.set(line.sportsbook, [...(books.get(line.sportsbook) ?? []), line]);
      const expectedOutcomes = new Set(group.map((line) => line.outcome));
      const outcomeProbabilities = new Map<string, number[]>();
      for (const bookLines of books.values()) {
        const bestByOutcome = new Map<string, NormalizedOdds>();
        for (const line of bookLines) {
          const current = bestByOutcome.get(line.outcome);
          if (!current || line.decimalOdds > current.decimalOdds) bestByOutcome.set(line.outcome, line);
        }
        const complete = [...bestByOutcome.values()];
        const impliedTotal = complete.reduce((sum, line) => sum + 1 / line.decimalOdds, 0);
        if (complete.length !== expectedOutcomes.size || !impliedTotal) continue;
        for (const line of complete) {
          outcomeProbabilities.set(line.outcome, [
            ...(outcomeProbabilities.get(line.outcome) ?? []),
            (1 / line.decimalOdds) / impliedTotal,
          ]);
        }
      }
      for (const line of group) {
        const values = outcomeProbabilities.get(line.outcome) ?? [];
        if (values.length) {
          probabilities.set(`${line.eventId}|${line.market}|${Math.abs(line.point ?? 0)}|${line.outcome}`, {
            fairProbability: values.reduce((sum, value) => sum + value, 0) / values.length,
            bookCount: values.length,
          });
        }
      }
      const bestByOutcome = new Map<string, NormalizedOdds>();
      for (const line of group) {
        const current = bestByOutcome.get(line.outcome);
        if (!current || line.decimalOdds > current.decimalOdds) bestByOutcome.set(line.outcome, line);
      }
      const legs = [...bestByOutcome.values()];
      const overround = legs.length > 1 ? legs.reduce((sum, line) => sum + 1 / line.decimalOdds, 0) : 1;
      if (legs.length === expectedOutcomes.size && overround < 1) {
        arbitrage.push({
          event: legs[0]!.event,
          market: legs[0]!.market,
          point: legs[0]!.point ?? null,
          overround,
          legs: legs.map((line) => ({ outcome: line.outcome, sportsbook: line.sportsbook, odds: line.decimalOdds, stakeFraction: (1 / line.decimalOdds) / overround })),
        });
      }
    }
    const quotes = rawLines.map((line) => {
      const probability = probabilities.get(`${line.eventId}|${line.market}|${Math.abs(line.point ?? 0)}|${line.outcome}`);
      const fairProbability = probability?.fairProbability ?? null;
      const previousOdds = history.get(`${line.eventId}|${line.market}|${line.point ?? ""}|${line.outcome}|${line.sportsbook}`) ?? null;
      return {
        ...line,
        impliedProbability: 1 / line.decimalOdds,
        fairProbability,
        bookCount: probability?.bookCount ?? 0,
        expectedValue: fairProbability === null ? null : fairProbability * line.decimalOdds - 1,
        calibratedProbability: calibration.predict(line.decimalOdds),
        modelStatus: calibration.status,
        previousOdds,
        movement: previousOdds === null ? null : line.decimalOdds - previousOdds,
      };
    });
    const bestBySelection = new Map<string, typeof quotes[number]>();
    for (const line of quotes) {
      const key = `${line.eventId}|${line.market}|${Math.abs(line.point ?? 0)}|${line.outcome}`;
      const current = bestBySelection.get(key);
      if (!current || line.decimalOdds > current.decimalOdds) bestBySelection.set(key, line);
    }
    const lines = [...bestBySelection.values()];
    if (rawLines.length) {
      const stored = rawLines.slice(0, 1000);
      for (let offset = 0; offset < stored.length; offset += 200) {
        const batch = stored.slice(offset, offset + 200);
        const values: unknown[] = [];
        const tuples = batch.map((line, index) => {
          const base = index * 10;
          values.push(req.user!.id, line.eventId, line.sport, line.event, line.commenceTime, line.market,
            line.point ?? null, line.outcome, line.sportsbook, line.decimalOdds);
          return `(${Array.from({ length: 10 }, (_, column) => `$${base + column + 1}`).join(",")})`;
        });
        await pool.query(
          `INSERT INTO odds_snapshots(user_id,event_id,sport,event,commence_time,market,point,outcome,sportsbook,decimal_odds)
           VALUES ${tuples.join(",")}`,
          values,
        );
      }
    }
    await pool.query("DELETE FROM odds_snapshots WHERE user_id=$1 AND observed_at < NOW() - INTERVAL '30 days'", [req.user!.id]);
    res.json({
      source: rawLines.length ? "The Odds API" : process.env.ODDS_API_KEY ? "provider_empty" : "not_configured",
      sport,
      includeProps,
      lineCount: lines.length,
      quotes,
      lines,
      arbitrage,
      model: {
        algorithm: calibration.algorithm,
        status: calibration.status,
        sampleSize: calibration.sampleSize,
        minimumSampleSize: calibration.minimumSampleSize,
        brierScore: calibration.brierScore,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/odds/movement", async (req: AuthRequest, res, next) => {
  try {
    const result = await pool.query(
      `SELECT event_id, sport, event, market, point, outcome, sportsbook,
        (ARRAY_AGG(decimal_odds ORDER BY observed_at ASC))[1] AS opening_odds, MAX(decimal_odds) AS high_odds,
        (ARRAY_AGG(decimal_odds ORDER BY observed_at DESC))[1] AS latest_odds,
        COUNT(*) AS observations, MIN(observed_at) AS first_seen, MAX(observed_at) AS last_seen
       FROM odds_snapshots
       WHERE user_id=$1 AND observed_at > NOW() - INTERVAL '7 days'
       GROUP BY event_id, sport, event, market, point, outcome, sportsbook
       HAVING COUNT(*) > 1
       ORDER BY MAX(observed_at) DESC LIMIT 300`,
      [req.user!.id],
    );
    res.json({ movements: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get("/odds/model", async (req: AuthRequest, res, next) => {
  try {
    const calibration = await trainOddsCalibration(req.user!.id);
    res.json({
      algorithm: calibration.algorithm,
      status: calibration.status,
      sampleSize: calibration.sampleSize,
      minimumSampleSize: calibration.minimumSampleSize,
      brierScore: calibration.brierScore,
      message: calibration.status === "trained"
        ? "Estimates calibrate market-implied probabilities to your settled bet history; they are not independent game predictions."
        : `Log ${calibration.minimumSampleSize - calibration.sampleSize} more settled decisions before personal odds calibration is enabled.`,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/odds/risk", async (req: AuthRequest, res, next) => {
  try {
    const [bankrollResult, exposureResult] = await Promise.all([
      pool.query("SELECT starting_bankroll,current_bankroll,unit_size FROM bankroll WHERE user_id=$1", [req.user!.id]),
      pool.query("SELECT COALESCE(SUM(stake),0) AS open_stake FROM bets WHERE user_id=$1 AND result='pending'", [req.user!.id]),
    ]);
    const bankroll = bankrollResult.rows[0] ?? { starting_bankroll: 1000, current_bankroll: 1000, unit_size: 25 };
    const current = Number(bankroll.current_bankroll);
    const openStake = Number(exposureResult.rows[0].open_stake);
    res.json({
      bankroll,
      openStake,
      exposurePercent: current > 0 ? openStake / current * 100 : 0,
      portfolioRiskLimit: current * 0.05,
      availableRiskBudget: Math.max(0, current * 0.05 - openStake),
      unitCap: current * 0.01,
      sizing: "Quarter-Kelly recommendations are displayed only when market probabilities are available; all portfolio allocations are capped to 5% of current bankroll.",
    });
  } catch (error) {
    next(error);
  }
});

router.put("/sportsbooks/:id/favorite", async (req: AuthRequest, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid sportsbook ID" });
    return;
  }
  try {
    const exists = await pool.query("SELECT id FROM sportsbooks WHERE id=$1", [id]);
    if (!exists.rows[0]) {
      res.status(404).json({ error: "Sportsbook not found" });
      return;
    }
    const favorite = req.body.favorite === true;
    if (favorite) {
      await pool.query("INSERT INTO favorite_sportsbooks(user_id,sportsbook_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.user!.id, id]);
    } else {
      await pool.query("DELETE FROM favorite_sportsbooks WHERE user_id=$1 AND sportsbook_id=$2", [req.user!.id, id]);
    }
    res.json({ favorite });
  } catch (error) {
    next(error);
  }
});

export default router;
