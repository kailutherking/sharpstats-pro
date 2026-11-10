import { pool } from "../../db/pool";
import { ruleMatches, type AlertRule, type AlertType, type OddsAlert } from "../oddsAlerts.service";
import { addFeedEvent } from "./feed.service";
import { notify, type NotificationDraft, type NotificationType } from "./notification.service";

const TYPE_FOR: Record<AlertType, NotificationType> = {
  line_move: "line_move", steam: "line_move", sharp: "line_move", reverse_move: "line_move", best_price: "odds_change", clv: "odds_change",
  positive_ev: "positive_ev", arbitrage: "arbitrage",
  injury_out: "injury", injury_upgrade: "injury", injury_downgrade: "injury", injury_return: "injury", injury_line: "injury",
};
const MARKET_FEED: AlertType[] = ["steam", "sharp", "reverse_move", "arbitrage", "injury_line"];

/**
 * Turns freshly stored odds and injury alerts into feed events and personal notifications:
 * custom alert rule matches, plus injury news for players and teams the user follows.
 */
export async function onAlertsStored(alerts: OddsAlert[]): Promise<void> {
  if (!alerts.length) return;
  try {
    for (const alert of alerts) {
      if (alert.type.startsWith("injury") && alert.type !== "injury_line") {
        await addFeedEvent({ type: "injury", league: alert.sport, title: alert.title, body: alert.message, ref: { athleteId: alert.sideId, teamId: alert.gameId.startsWith("team:") ? alert.gameId.slice(5) : null, alertType: alert.type }, dedupeKey: `alert:${alert.id}` });
      } else if (MARKET_FEED.includes(alert.type) && alert.severity !== "info") {
        await addFeedEvent({ type: "market", league: alert.sport, title: alert.title, body: alert.message, ref: { gameId: alert.gameId, sideId: alert.sideId, alertType: alert.type }, dedupeKey: `alert:${alert.id}` });
      }
    }
    const rules = await pool.query<{ id: number; user_id: number; name: string; alert_type: AlertType; sport: AlertRule["sport"]; market_key: string | null; book_key: string | null; query: string | null; min_value: string | null }>(
      "SELECT id, user_id, name, alert_type, sport, market_key, book_key, query, min_value::text FROM odds_alert_rules WHERE active");
    const drafts: NotificationDraft[] = [];
    for (const row of rules.rows) {
      const rule: AlertRule = { id: row.id, name: row.name, type: row.alert_type, sport: row.sport, market: row.market_key, book: row.book_key, query: row.query, minValue: row.min_value === null ? null : Number(row.min_value), active: true, createdAt: "" };
      for (const alert of alerts) {
        if (ruleMatches(rule, alert)) drafts.push({ userId: row.user_id, type: TYPE_FOR[alert.type], title: alert.title, body: `${alert.message} (rule: ${rule.name})`, link: { page: "Odds screen", league: alert.sport, gameId: alert.gameId }, dedupeKey: `alert:${alert.id}` });
      }
    }
    const injuries = alerts.filter((alert) => alert.type.startsWith("injury") && alert.sideId);
    if (injuries.length) {
      const followers = await pool.query<{ user_id: number; league: string; entity_type: string; entity_id: string }>(
        `SELECT user_id, league, entity_type, entity_id FROM favorite_stats WHERE (entity_type='player' AND entity_id = ANY($1::text[])) OR (entity_type='team' AND entity_id = ANY($2::text[]))`,
        [injuries.map((alert) => alert.sideId), injuries.map((alert) => (alert.gameId.startsWith("team:") ? alert.gameId.slice(5) : ""))]);
      for (const alert of injuries) {
        const teamId = alert.gameId.startsWith("team:") ? alert.gameId.slice(5) : null;
        for (const row of followers.rows.filter((item) => item.league === alert.sport && ((item.entity_type === "player" && item.entity_id === alert.sideId) || (item.entity_type === "team" && item.entity_id === teamId)))) {
          drafts.push({ userId: row.user_id, type: "injury", title: alert.title, body: alert.message, link: { page: "Injury report", league: alert.sport, athleteId: alert.sideId ?? undefined }, dedupeKey: `alert:${alert.id}` });
        }
      }
    }
    await notify(drafts);
  } catch (error) {
    console.warn("Alert fan-out failed", error instanceof Error ? error.message : error);
  }
}
