import { onBetSettled } from "../services/social/pick.service";
import { evaluateUser } from "../services/social/gamification.service";
import { Router } from "express";
import type { PoolClient } from "pg";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { calculateProfitLoss, createBet, syncBankroll } from "../services/bets";
import { gradePendingBets } from "../services/grading";
import type { AuthRequest, BetRow } from "../types";

const router = Router();
router.use(requireAuth);
const betSchema = z.object({
  sport: z.string().trim().min(1).max(60),
  league: z.string().trim().max(80).default(""),
  event: z.string().trim().min(1).max(180),
  bet_type: z.string().trim().min(1).max(80).default("Moneyline"),
  team_player: z.string().trim().max(120).default(""),
  odds: z.coerce.number().finite().gt(1).max(1000),
  stake: z.coerce.number().finite().gt(0).max(1_000_000),
  result: z.enum(["pending", "win", "loss", "push"]).default("pending"),
  sportsbook: z.string().trim().min(1).max(80),
  bet_date: z.coerce.date().default(() => new Date()),
  closing_odds: z.preprocess(
    (value) => value === "" || value === undefined ? null : value,
    z.union([z.coerce.number().gt(1).max(1000), z.null()]),
  ),
  market_key: z.string().trim().min(1).max(80).default("h2h"),
  selection: z.string().trim().max(180).default(""),
  line_value: z.preprocess(
    (value) => value === "" || value === undefined ? null : value,
    z.union([z.coerce.number().finite().min(-10000).max(10000), z.null()]),
  ).default(null),
  event_id: z.preprocess(
    (value) => value === "" || value === undefined ? null : value,
    z.union([z.string().trim().max(100), z.null()]),
  ),
  notes: z.string().max(2000).default(""),
});

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const search = typeof req.query.search === "string" ? `%${req.query.search.slice(0, 100)}%` : null;
    const result = await pool.query(
      `SELECT * FROM bets WHERE user_id = $1 AND ($2::text IS NULL OR
       event ILIKE $2 OR sport ILIKE $2 OR sportsbook ILIKE $2 OR league ILIKE $2)
       ORDER BY bet_date DESC LIMIT 500`,
      [req.user!.id, search],
    );
    res.json({ bets: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const data = betSchema.parse(req.body);
    const bet = await createBet(req.user!.id, { ...data, bet_date: data.bet_date.toISOString() });
    void evaluateUser(req.user!.id);
    res.status(201).json({ bet });
  } catch (error) {
    next(error);
  }
});

router.post("/grade", async (req: AuthRequest, res, next) => {
  try {
    res.json(await gradePendingBets(req.user!.id));
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (req: AuthRequest, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid bet ID" });
    return;
  }
  const updates = betSchema.partial();
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const data = updates.parse(req.body);
    await client.query("BEGIN");
    const existing = await client.query("SELECT * FROM bets WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, req.user!.id]);
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Bet not found" });
      return;
    }
    const current = existing.rows[0] as BetRow & { source?: string };
    if (current.source === "simulated") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Simulated wagers are graded automatically. Cancel an open one from Open wagers instead." });
      return;
    }
    const merged = { ...current, ...data };
    const profitLoss = calculateProfitLoss(merged.result, Number(merged.odds), Number(merged.stake));
    const result = await client.query(
      `UPDATE bets SET sport=$1, league=$2, event=$3, bet_type=$4, team_player=$5, odds=$6,
       stake=$7, result=$8, profit_loss=$9, sportsbook=$10, bet_date=$11, closing_odds=$12,
       market_key=$13, selection=$14, line_value=$15, event_id=$16, notes=$17
       WHERE id=$18 AND user_id=$19 RETURNING *`,
      [merged.sport, merged.league, merged.event, merged.bet_type, merged.team_player, merged.odds,
        merged.stake, merged.result, profitLoss, merged.sportsbook, merged.bet_date,
        merged.closing_odds, merged.market_key, merged.selection, merged.line_value, merged.event_id,
        merged.notes, id, req.user!.id],
    );
    await syncBankroll(client, req.user!.id);
    await client.query("COMMIT");
    if (current.result !== merged.result) void onBetSettled(req.user!.id, id, "manual");
    res.json({ bet: result.rows[0] });
  } catch (error) {
    try {
      await client?.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Could not roll back bet update", rollbackError);
    }
    next(error);
  } finally {
    client?.release();
  }
});

router.delete("/:id", async (req: AuthRequest, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid bet ID" });
    return;
  }
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    // Simulated wagers hold bankroll and ledger entries; they are cancelled or settled, never deleted.
    const result = await client.query("DELETE FROM bets WHERE id = $1 AND user_id = $2 AND source <> 'simulated'", [id, req.user!.id]);
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      const simulated = await pool.query("SELECT 1 FROM bets WHERE id=$1 AND user_id=$2 AND source='simulated'", [id, req.user!.id]);
      res.status(simulated.rowCount ? 409 : 404).json({ error: simulated.rowCount ? "Simulated wagers cannot be deleted. Cancel an open one from Open wagers instead." : "Bet not found" });
      return;
    }
    await syncBankroll(client, req.user!.id);
    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) {
    try {
      await client?.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Could not roll back bet deletion", rollbackError);
    }
    next(error);
  } finally {
    client?.release();
  }
});

router.get("/export", async (req: AuthRequest, res, next) => {
  try {
    const result = await pool.query(
      "SELECT sport, league, event, bet_type, team_player, odds, stake, result, sportsbook, bet_date, closing_odds, market_key, selection, line_value, event_id, notes, profit_loss FROM bets WHERE user_id=$1 ORDER BY bet_date DESC",
      [req.user!.id],
    );
    const headers = ["sport", "league", "event", "bet_type", "team_player", "odds", "stake", "result", "sportsbook", "date", "closing_odds", "market_key", "selection", "line_value", "event_id", "notes", "profit_loss"];
    const escape = (value: unknown) => {
      const text = String(value ?? "");
      const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const lines = result.rows.map((row) => headers.map((header) => escape(header === "date" ? row.bet_date : row[header])).join(","));
    res.type("text/csv").attachment("sharpstats-bets.csv").send([headers.join(","), ...lines].join("\n"));
  } catch (error) {
    next(error);
  }
});

router.get("/report/:format", async (req: AuthRequest, res, next) => {
  const format = req.params.format;
  if (format !== "xlsx" && format !== "pdf") {
    res.status(400).json({ error: "Report format must be xlsx or pdf" });
    return;
  }
  try {
    const result = await pool.query(
      `SELECT bet_date, sport, league, event, market_key, bet_type, selection, odds, stake,
        sportsbook, result, profit_loss, closing_odds, notes
       FROM bets WHERE user_id=$1 ORDER BY bet_date DESC LIMIT 5000`,
      [req.user!.id],
    );
    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "SharpStats Pro";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("Bet history");
      sheet.columns = [
        { header: "Date", key: "bet_date", width: 22 },
        { header: "Sport", key: "sport", width: 14 },
        { header: "League", key: "league", width: 16 },
        { header: "Event", key: "event", width: 32 },
        { header: "Market", key: "market_key", width: 22 },
        { header: "Bet type", key: "bet_type", width: 18 },
        { header: "Selection", key: "selection", width: 24 },
        { header: "Odds", key: "odds", width: 12 },
        { header: "Stake", key: "stake", width: 14 },
        { header: "Sportsbook", key: "sportsbook", width: 18 },
        { header: "Result", key: "result", width: 12 },
        { header: "Profit / loss", key: "profit_loss", width: 16 },
        { header: "Closing odds", key: "closing_odds", width: 14 },
        { header: "Notes", key: "notes", width: 38 },
      ];
      sheet.getRow(1).font = { bold: true, color: { argb: "FFC5F467" } };
      sheet.addRows(result.rows);
      sheet.getColumn("bet_date").numFmt = "yyyy-mm-dd hh:mm";
      sheet.getColumn("odds").numFmt = "0.000";
      sheet.getColumn("stake").numFmt = "$#,##0.00";
      sheet.getColumn("profit_loss").numFmt = "$#,##0.00;[Red]-$#,##0.00";
      sheet.getColumn("closing_odds").numFmt = "0.000";
      const buffer = await workbook.xlsx.writeBuffer();
      res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .attachment("sharpstats-bets.xlsx").send(Buffer.from(buffer));
      return;
    }

    res.type("application/pdf").attachment("sharpstats-report.pdf");
    const document = new PDFDocument({ size: "LETTER", margin: 40, bufferPages: true });
    document.pipe(res);
    document.fontSize(20).fillColor("#1c2a1c").text("SharpStats Pro", { continued: true });
    document.fontSize(11).fillColor("#65716a").text("  ·  Bet history report");
    document.moveDown().fontSize(9).fillColor("#65716a")
      .text(`Generated ${new Date().toLocaleString()}  |  ${result.rowCount ?? 0} bets`);
    document.moveDown();
    for (const [index, bet] of result.rows.entries()) {
      if (document.y > 700) document.addPage();
      document.fontSize(10).fillColor("#18221b")
        .text(`${new Date(bet.bet_date).toLocaleDateString()}  ·  ${bet.event}  ·  ${bet.selection || bet.bet_type}`);
      document.fontSize(8).fillColor("#65716a")
        .text(`${bet.sport} / ${bet.league}  |  ${bet.sportsbook}  |  ${bet.result}  |  Odds ${bet.odds}  |  Stake $${bet.stake}  |  P/L $${bet.profit_loss}`);
      if (bet.notes) document.text(`Notes: ${bet.notes}`);
      document.moveDown(0.65);
      if (index > 0 && index % 20 === 0) document.addPage();
    }
    document.end();
  } catch (error) {
    next(error);
  }
});

router.post("/import", async (req: AuthRequest, res, next) => {
  try {
    const rows = z.array(z.record(z.string(), z.string())).min(1).max(500).parse(req.body.rows);
    let imported = 0;
    const errors: { row: number; message: string }[] = [];
    for (const [index, row] of rows.entries()) {
      const parsed = betSchema.safeParse({
        ...row,
        bet_date: row.date || row.bet_date || new Date().toISOString(),
        odds: row.odds,
        stake: row.stake,
      });
      if (!parsed.success) {
        errors.push({ row: index + 1, message: parsed.error.issues[0]?.message ?? "Invalid bet row" });
        continue;
      }
      await createBet(req.user!.id, { ...parsed.data, bet_date: parsed.data.bet_date.toISOString() });
      imported += 1;
    }
    res.status(201).json({ imported, skipped: errors.length, errors });
  } catch (error) {
    next(error);
  }
});

export default router;
