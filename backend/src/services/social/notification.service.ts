import { pool } from "../../db/pool";
import { publishToUser } from "./realtime.service";

export const NOTIFICATION_TYPES = [
  "prop_hit", "bet_result", "injury", "line_move", "odds_change", "positive_ev", "arbitrage",
  "follower", "following_pick", "reaction", "comment", "streak", "achievement", "news",
] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];

/** Defaults: everything on except general news, which is noisy. */
export const DEFAULT_PREFERENCES: Record<NotificationType, boolean> = Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, type !== "news"])) as Record<NotificationType, boolean>;

export interface NotificationLink { page?: string; league?: string; gameId?: string; handle?: string; postId?: number; athleteId?: string }

export interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  link: NotificationLink;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationDraft { userId: number; type: NotificationType; title: string; body?: string; link?: NotificationLink; dedupeKey?: string }

export async function preferencesFor(userIds: number[]): Promise<Map<number, Record<NotificationType, boolean>>> {
  const map = new Map<number, Record<NotificationType, boolean>>(userIds.map((id) => [id, { ...DEFAULT_PREFERENCES }]));
  if (!userIds.length) return map;
  const rows = await pool.query<{ user_id: number; notifications: Partial<Record<NotificationType, boolean>> }>(
    "SELECT user_id, notifications FROM user_preferences WHERE user_id = ANY($1::int[])", [userIds],
  );
  for (const row of rows.rows) map.set(row.user_id, { ...DEFAULT_PREFERENCES, ...row.notifications });
  return map;
}

/** Creates notifications (respecting each user's switches and dedupe keys) and pushes them live. */
export async function notify(drafts: NotificationDraft[]): Promise<Notification[]> {
  if (!drafts.length) return [];
  try {
    const prefs = await preferencesFor([...new Set(drafts.map((draft) => draft.userId))]);
    const allowed = drafts.filter((draft) => prefs.get(draft.userId)?.[draft.type] !== false).slice(0, 500);
    if (!allowed.length) return [];
    const result = await pool.query<{ id: string; user_id: number; type: NotificationType; title: string; body: string; link: NotificationLink; read_at: Date | null; created_at: Date }>(
      `INSERT INTO notifications(user_id, type, title, body, link, dedupe_key)
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::jsonb[], $6::text[])
       ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
       RETURNING id, user_id, type, title, body, link, read_at, created_at`,
      [allowed.map((d) => d.userId), allowed.map((d) => d.type), allowed.map((d) => d.title.slice(0, 200)), allowed.map((d) => (d.body ?? "").slice(0, 600)),
        allowed.map((d) => JSON.stringify(d.link ?? {})), allowed.map((d) => d.dedupeKey ?? null)],
    );
    const created = result.rows.map((row) => ({ userId: row.user_id, notification: fromRow(row) }));
    for (const { userId, notification } of created) publishToUser(userId, "notification", notification);
    return created.map((item) => item.notification);
  } catch (error) {
    console.warn("Notification write failed", error instanceof Error ? error.message : error);
    return [];
  }
}

function fromRow(row: { id: string; type: NotificationType; title: string; body: string; link: NotificationLink; read_at: Date | null; created_at: Date }): Notification {
  return { id: Number(row.id), type: row.type, title: row.title, body: row.body, link: row.link ?? {}, readAt: row.read_at?.toISOString() ?? null, createdAt: row.created_at.toISOString() };
}

export async function listNotifications(userId: number, options: { limit: number; unreadOnly?: boolean }) {
  const [rows, unread] = await Promise.all([
    pool.query(`SELECT id, type, title, body, link, read_at, created_at FROM notifications WHERE user_id=$1 ${options.unreadOnly ? "AND read_at IS NULL" : ""} ORDER BY created_at DESC LIMIT $2`, [userId, options.limit]),
    pool.query<{ count: string }>("SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND read_at IS NULL", [userId]),
  ]);
  return { notifications: rows.rows.map(fromRow), unread: Number(unread.rows[0]?.count ?? 0) };
}

export async function markRead(userId: number, ids: number[] | "all"): Promise<number> {
  const result = ids === "all"
    ? await pool.query("UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL", [userId])
    : await pool.query("UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND id = ANY($2::bigint[]) AND read_at IS NULL", [userId, ids]);
  return result.rowCount ?? 0;
}

export async function getPreferences(userId: number): Promise<Record<NotificationType, boolean>> {
  return (await preferencesFor([userId])).get(userId)!;
}

export async function setPreferences(userId: number, changes: Partial<Record<NotificationType, boolean>>): Promise<Record<NotificationType, boolean>> {
  const current = await getPreferences(userId);
  const next = { ...current, ...changes };
  await pool.query(
    `INSERT INTO user_preferences(user_id, notifications, updated_at) VALUES($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET notifications=EXCLUDED.notifications, updated_at=NOW()`,
    [userId, JSON.stringify(next)],
  );
  return next;
}

/** Old read notifications are trimmed; unread ones are kept. */
export async function pruneNotifications(): Promise<void> {
  await pool.query("DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < NOW() - INTERVAL '60 days'").catch(() => undefined);
}
