import { pool } from "../db/pool";
import { bookByKey, type OddsSport } from "./oddsCatalog";
import type { ArbitrageOpportunity, Selection } from "./oddsAggregator.service";
import type { MoveEvent } from "./lineMovement.service";
import type { OddsGame } from "./oddsTypes";

export const ALERT_TYPES = [
  "line_move", "steam", "sharp", "reverse_move", "positive_ev", "arbitrage", "best_price", "clv",
  "injury_out", "injury_upgrade", "injury_downgrade", "injury_return", "injury_line",
] as const;
export type AlertType = typeof ALERT_TYPES[number];

export interface OddsAlert {
  id: number;
  type: AlertType;
  sport: OddsSport;
  gameId: string;
  game: string;
  market: string;
  sideId: string | null;
  book: string | null;
  title: string;
  message: string;
  severity: "info" | "notice" | "high";
  value: number | null;
  createdAt: string;
}

export type AlertDraft = Omit<OddsAlert, "id" | "createdAt"> & { signature: string };
type Draft = AlertDraft;

/** Alert thresholds (probability points unless noted). */
export const ALERT_THRESHOLDS = {
  lineMoveProbability: 0.03,
  lineMovePoints: 1,
  ev: 0.03,
  bestPriceEdge: 0.03,
  clvMarketMove: 0.02,
};

const DEDUPE_BUCKET_MS = 30 * 60_000;
const previous = new Map<OddsSport, { steam: Set<string>; sharp: Set<string>; reverse: Set<string>; best: Map<string, string>; clv: Set<string> }>();

function american(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function bookName(key: string): string {
  return bookByKey(key)?.name ?? key;
}

function gameLabel(game: OddsGame | undefined): string {
  return game ? `${game.awayTeam} @ ${game.homeTeam}` : "";
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Alerts cover games that haven't started. In-play prices move on every play and books update
 * seconds apart, so live moves, gaps and "edges" are mostly noise and would flood the feed.
 */
export function buildAlerts(raw: {
  sport: OddsSport;
  games: Map<string, OddsGame>;
  selections: Selection[];
  moves: MoveEvent[];
  openedArbitrage: ArbitrageOpportunity[];
  openedEv: Set<string>;
  now?: number;
}): Draft[] {
  const pregame = (gameId: string) => raw.games.get(gameId)?.status !== "live";
  const input = {
    ...raw,
    selections: raw.selections.filter((selection) => pregame(selection.gameId)),
    moves: raw.moves.filter((move) => pregame(move.gameId)),
    openedArbitrage: raw.openedArbitrage.filter((opportunity) => pregame(opportunity.gameId)),
  };
  const now = input.now ?? Date.now();
  const bucket = Math.floor(now / DEDUPE_BUCKET_MS);
  const state = previous.get(input.sport) ?? { steam: new Set<string>(), sharp: new Set<string>(), reverse: new Set<string>(), best: new Map<string, string>(), clv: new Set<string>() };
  const firstRun = !previous.has(input.sport);
  const drafts: Draft[] = [];
  const bySide = new Map(input.selections.map((selection) => [selection.id, selection]));
  const base = (selection: Selection | undefined, gameId: string) => ({
    sport: input.sport,
    gameId,
    game: gameLabel(input.games.get(gameId)),
    market: selection?.market ?? "",
    sideId: selection?.id ?? null,
  });

  // Line movement: group this snapshot's moves per side so a market-wide move is one alert.
  const movesBySide = new Map<string, MoveEvent[]>();
  for (const move of input.moves) movesBySide.set(move.sideId, [...(movesBySide.get(move.sideId) ?? []), move]);
  for (const [sideId, moves] of movesBySide) {
    const selection = bySide.get(sideId);
    const significant = moves.filter((move) => Math.abs(move.probabilityDelta) >= ALERT_THRESHOLDS.lineMoveProbability
      || (move.fromPoint !== null && move.toPoint !== null && Math.abs(move.toPoint - move.fromPoint) >= ALERT_THRESHOLDS.lineMovePoints));
    if (!significant.length || !selection) continue;
    const lead = significant[0]!;
    const detail = lead.fromPoint !== lead.toPoint && lead.fromPoint !== null && lead.toPoint !== null
      ? `${lead.fromPoint} → ${lead.toPoint}`
      : `${american(lead.fromAmerican)} → ${american(lead.toAmerican)}`;
    drafts.push({
      ...base(selection, lead.gameId),
      type: "line_move",
      book: significant.length === 1 ? lead.book : null,
      title: `Line move · ${selection.label}`,
      message: significant.length === 1
        ? `${bookName(lead.book)} moved ${selection.marketLabel.toLowerCase()} ${detail}.`
        : `${significant.length} books moved ${selection.marketLabel.toLowerCase()} (${bookName(lead.book)} ${detail}).`,
      severity: significant.length >= 3 ? "notice" : "info",
      value: lead.probabilityDelta,
      signature: `line_move|${sideId}|${lead.toAmerican}|${lead.toPoint ?? ""}|${bucket}`,
    });
  }

  const steam = new Set<string>();
  const sharp = new Set<string>();
  const reverse = new Set<string>();
  const clv = new Set<string>();
  for (const selection of input.selections) {
    if (selection.signals.steam) {
      steam.add(selection.id);
      if (!state.steam.has(selection.id)) drafts.push({
        ...base(selection, selection.gameId), type: "steam", book: null,
        title: `Steam move · ${selection.label}`,
        message: `Multiple sportsbooks moved toward ${selection.label} within minutes${selection.best ? ` — best now ${american(selection.best.american)} at ${bookName(selection.best.book)}` : ""}.`,
        severity: "high", value: selection.signals.moves, signature: `steam|${selection.id}|${bucket}`,
      });
    }
    if (selection.signals.sharp) {
      sharp.add(selection.id);
      if (!state.sharp.has(selection.id)) drafts.push({
        ...base(selection, selection.gameId), type: "sharp", book: null,
        title: `Sharp action · ${selection.label}`,
        message: "The sharp reference market moved on this side; recreational books may follow.",
        severity: "high", value: null, signature: `sharp|${selection.id}|${bucket}`,
      });
    }
    if (selection.signals.reverse) {
      reverse.add(selection.id);
      if (!state.reverse.has(selection.id)) drafts.push({
        ...base(selection, selection.gameId), type: "reverse_move", book: null,
        title: `Reverse line move · ${selection.label}`,
        message: "The line moved toward the side the public usually avoids (underdog or under), an estimated sign of sharp money.",
        severity: "notice", value: null, signature: `reverse_move|${selection.id}|${bucket}`,
      });
    }
    const bestPrice = selection.best;
    if (bestPrice && selection.ev !== null && selection.ev >= ALERT_THRESHOLDS.ev && input.openedEv.has(`${selection.id}|${bestPrice.book}|${bestPrice.american}`)) {
      drafts.push({
        ...base(selection, selection.gameId), type: "positive_ev", book: bestPrice.book,
        title: `${selection.tier === "elite" ? "Elite" : "Strong"} +EV · ${selection.label}`,
        message: `${american(bestPrice.american)} at ${bookName(bestPrice.book)} vs fair ${selection.fair?.american === null || !selection.fair ? "—" : american(selection.fair.american)} (${pct(selection.ev)} EV).`,
        severity: selection.tier === "elite" ? "high" : "notice", value: selection.ev,
        signature: `positive_ev|${selection.id}|${bestPrice.book}|${bestPrice.american}`,
      });
    }
    if (bestPrice && selection.average) {
      const previousBest = state.best.get(selection.id);
      const edge = selection.average.implied - 1 / bestPrice.decimal;
      if (previousBest && previousBest !== bestPrice.book && edge >= ALERT_THRESHOLDS.bestPriceEdge) drafts.push({
        ...base(selection, selection.gameId), type: "best_price", book: bestPrice.book,
        title: `Best price · ${selection.label}`,
        message: `${bookName(bestPrice.book)} now leads at ${american(bestPrice.american)} (market average ${selection.average.american === null ? "—" : american(selection.average.american)}).`,
        severity: "info", value: edge, signature: `best_price|${selection.id}|${bestPrice.book}|${bestPrice.american}`,
      });
    }
    // CLV opportunity: the market has moved toward this side but a book still hangs its opener.
    const movedToward = selection.books.filter((price) => price.priced && (price.probabilityMove ?? 0) >= ALERT_THRESHOLDS.clvMarketMove);
    const stale = selection.books.filter((price) => price.priced && price.atLine && price.open && Math.abs(price.probabilityMove ?? 1) < 0.005
      && selection.average !== null && price.implied < selection.average.implied);
    if (movedToward.length >= 2 && stale.length) {
      clv.add(selection.id);
      if (!state.clv.has(selection.id)) {
        const target = stale.sort((a, b) => b.decimal - a.decimal)[0]!;
        drafts.push({
          ...base(selection, selection.gameId), type: "clv", book: target.book,
          title: `CLV opportunity · ${selection.label}`,
          message: `${movedToward.length} books moved toward this side; ${bookName(target.book)} still offers ${american(target.american)}.`,
          severity: "notice", value: movedToward.length, signature: `clv|${selection.id}|${target.book}|${target.american}`,
        });
      }
    }
  }

  for (const opportunity of input.openedArbitrage) {
    drafts.push({
      sport: input.sport, gameId: opportunity.gameId, game: gameLabel(input.games.get(opportunity.gameId)),
      market: opportunity.market, sideId: opportunity.legs[0]?.selectionId ?? null, book: null, type: "arbitrage",
      title: `Arbitrage · ${pct(opportunity.profitPct)} ${opportunity.marketLabel.toLowerCase()}`,
      message: opportunity.legs.map((leg) => `${leg.label} ${american(leg.american)} (${bookName(leg.book)})`).join(" · "),
      severity: opportunity.profitPct >= 0.01 ? "high" : "notice", value: opportunity.profitPct,
      signature: `arbitrage|${opportunity.id}|${bucket}`,
    });
  }

  previous.set(input.sport, {
    steam, sharp, reverse, clv,
    best: new Map(input.selections.filter((selection) => selection.best).map((selection) => [selection.id, selection.best!.book])),
  });
  // The first snapshot after a restart only establishes the baseline for change-based alerts.
  return firstRun ? drafts.filter((draft) => draft.type === "arbitrage" || draft.type === "positive_ev") : drafts;
}

export async function storeAlerts(drafts: Draft[]): Promise<OddsAlert[]> {
  if (!drafts.length) return [];
  const unique = [...new Map(drafts.map((draft) => [draft.signature, draft])).values()].slice(0, 200);
  try {
    const result = await pool.query<AlertRow>(
      `INSERT INTO odds_alerts(signature, alert_type, sport, game_id, game_label, market_key, side_id, book_key, title, message, severity, value)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::numeric[])
       ON CONFLICT (signature) DO NOTHING
       RETURNING id, alert_type, sport, game_id, game_label, market_key, side_id, book_key, title, message, severity, value::text, created_at`,
      [
        unique.map((draft) => draft.signature), unique.map((draft) => draft.type), unique.map((draft) => draft.sport),
        unique.map((draft) => draft.gameId), unique.map((draft) => draft.game), unique.map((draft) => draft.market),
        unique.map((draft) => draft.sideId), unique.map((draft) => draft.book), unique.map((draft) => draft.title),
        unique.map((draft) => draft.message), unique.map((draft) => draft.severity), unique.map((draft) => draft.value),
      ],
    );
    return result.rows.map(fromRow);
  } catch (error) {
    console.warn("Odds alert write failed", error instanceof Error ? error.message : error);
    return [];
  }
}

interface AlertRow {
  id: string; alert_type: AlertType; sport: OddsSport; game_id: string; game_label: string; market_key: string; side_id: string | null;
  book_key: string | null; title: string; message: string; severity: OddsAlert["severity"]; value: string | null; created_at: Date;
}

function fromRow(row: AlertRow): OddsAlert {
  return {
    id: Number(row.id), type: row.alert_type, sport: row.sport, gameId: row.game_id, game: row.game_label, market: row.market_key,
    sideId: row.side_id, book: row.book_key, title: row.title, message: row.message, severity: row.severity,
    value: row.value === null ? null : Number(row.value), createdAt: row.created_at.toISOString(),
  };
}

/* ---------- Custom alert rules ---------- */

export interface AlertRule {
  id: number;
  name: string;
  type: AlertType;
  sport: OddsSport | null;
  market: string | null;
  book: string | null;
  query: string | null;
  minValue: number | null;
  active: boolean;
  createdAt: string;
}

interface RuleRow { id: number; name: string; alert_type: AlertType; sport: OddsSport | null; market_key: string | null; book_key: string | null; query: string | null; min_value: string | null; active: boolean; created_at: Date }

function ruleFromRow(row: RuleRow): AlertRule {
  return {
    id: row.id, name: row.name, type: row.alert_type, sport: row.sport, market: row.market_key, book: row.book_key,
    query: row.query, minValue: row.min_value === null ? null : Number(row.min_value), active: row.active, createdAt: row.created_at.toISOString(),
  };
}

export function ruleMatches(rule: AlertRule, alert: OddsAlert): boolean {
  if (!rule.active || rule.type !== alert.type) return false;
  if (rule.sport && rule.sport !== alert.sport) return false;
  if (rule.market && rule.market !== alert.market) return false;
  if (rule.book && alert.book && rule.book !== alert.book) return false;
  if (rule.book && !alert.book && !alert.message.toLowerCase().includes((bookByKey(rule.book)?.name ?? rule.book).toLowerCase())) return false;
  if (rule.query) {
    const haystack = `${alert.title} ${alert.message} ${alert.game}`.toLowerCase();
    if (!haystack.includes(rule.query.toLowerCase())) return false;
  }
  if (rule.minValue !== null && (alert.value === null || Math.abs(alert.value) < rule.minValue)) return false;
  return true;
}

export async function listRules(userId: number): Promise<AlertRule[]> {
  const result = await pool.query<RuleRow>(
    `SELECT id, name, alert_type, sport, market_key, book_key, query, min_value::text, active, created_at
     FROM odds_alert_rules WHERE user_id=$1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map(ruleFromRow);
}

export async function createRule(userId: number, rule: Omit<AlertRule, "id" | "createdAt" | "active">): Promise<AlertRule> {
  const result = await pool.query<RuleRow>(
    `INSERT INTO odds_alert_rules(user_id, name, alert_type, sport, market_key, book_key, query, min_value)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, name, alert_type, sport, market_key, book_key, query, min_value::text, active, created_at`,
    [userId, rule.name, rule.type, rule.sport, rule.market, rule.book, rule.query, rule.minValue],
  );
  return ruleFromRow(result.rows[0]!);
}

export async function updateRule(userId: number, id: number, active: boolean): Promise<AlertRule | null> {
  const result = await pool.query<RuleRow>(
    `UPDATE odds_alert_rules SET active=$3 WHERE user_id=$1 AND id=$2
     RETURNING id, name, alert_type, sport, market_key, book_key, query, min_value::text, active, created_at`,
    [userId, id, active],
  );
  return result.rows[0] ? ruleFromRow(result.rows[0]) : null;
}

export async function deleteRule(userId: number, id: number): Promise<boolean> {
  const result = await pool.query("DELETE FROM odds_alert_rules WHERE user_id=$1 AND id=$2", [userId, id]);
  return (result.rowCount ?? 0) > 0;
}

export async function listAlerts(userId: number, filters: { sport?: OddsSport; types?: AlertType[]; hours: number; limit: number; mine?: boolean }): Promise<{ alerts: Array<OddsAlert & { matchedRules: number[] }>; rules: AlertRule[] }> {
  const [result, rules] = await Promise.all([
    pool.query<AlertRow>(
      `SELECT id, alert_type, sport, game_id, game_label, market_key, side_id, book_key, title, message, severity, value::text, created_at
       FROM odds_alerts
       WHERE created_at > NOW() - make_interval(hours => $1)
         AND ($2::text IS NULL OR sport=$2) AND ($3::text[] IS NULL OR alert_type = ANY($3::text[]))
       ORDER BY created_at DESC LIMIT $4`,
      [filters.hours, filters.sport ?? null, filters.types?.length ? filters.types : null, filters.mine ? 1000 : filters.limit],
    ),
    listRules(userId),
  ]);
  const alerts = result.rows.map(fromRow).map((alert) => ({ ...alert, matchedRules: rules.filter((rule) => ruleMatches(rule, alert)).map((rule) => rule.id) }));
  return { alerts: (filters.mine ? alerts.filter((alert) => alert.matchedRules.length) : alerts).slice(0, filters.limit), rules };
}

export async function pruneAlerts(): Promise<void> {
  await pool.query("DELETE FROM odds_alerts WHERE created_at < NOW() - INTERVAL '7 days'");
}
