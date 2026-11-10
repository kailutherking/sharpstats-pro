import { pool } from "../../db/pool";
import type { League } from "../../providers/espnStats";
import { gameTopic, publishToTopic, topicViewers } from "./realtime.service";

export const LIVE_REACTIONS = ["fire", "money", "shock", "clap", "cold", "lock"] as const;
export type LiveReaction = typeof LIVE_REACTIONS[number];

export interface ChatMessage { id: number; author: { userId: number; handle: string; name: string; avatarUrl: string | null }; body: string; createdAt: string; isMine: boolean }

/** Collapses whitespace and drops control characters. */
const clean = (text: string) => [...text].map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char)).join("").replace(/\s+/g, " ").trim();

export async function gameChat(viewerId: number, league: League, eventId: string) {
  const [messages, gameReactions, playReactions, mine] = await Promise.all([
    pool.query<{ id: string; user_id: number; handle: string; username: string; avatar_url: string | null; body: string; created_at: Date }>(
      `SELECT e.id, e.user_id, p.handle, u.username, p.avatar_url, e.body, e.created_at FROM live_game_events e
       JOIN user_profiles p ON p.user_id=e.user_id JOIN users u ON u.id=e.user_id
       WHERE e.league=$1 AND e.event_id=$2 AND e.kind='chat' ORDER BY e.created_at DESC LIMIT 80`, [league, eventId]),
    pool.query<{ reaction: LiveReaction; n: string }>(
      `SELECT reaction, COUNT(*) AS n FROM live_game_events WHERE league=$1 AND event_id=$2 AND kind='reaction' AND play_id IS NULL AND created_at > NOW() - INTERVAL '15 minutes' GROUP BY reaction`, [league, eventId]),
    pool.query<{ play_id: string; reaction: LiveReaction; n: string }>(
      `SELECT play_id, reaction, COUNT(*) AS n FROM live_game_events WHERE league=$1 AND event_id=$2 AND kind='reaction' AND play_id IS NOT NULL GROUP BY play_id, reaction`, [league, eventId]),
    pool.query<{ play_id: string | null; reaction: LiveReaction }>(
      `SELECT DISTINCT play_id, reaction FROM live_game_events WHERE league=$1 AND event_id=$2 AND kind='reaction' AND user_id=$3 AND (play_id IS NOT NULL OR created_at > NOW() - INTERVAL '15 minutes')`, [league, eventId, viewerId]),
  ]);
  const plays: Record<string, Partial<Record<LiveReaction, number>>> = {};
  for (const row of playReactions.rows) (plays[row.play_id] ??= {})[row.reaction] = Number(row.n);
  return {
    messages: messages.rows.reverse().map((row) => ({ id: Number(row.id), author: { userId: row.user_id, handle: row.handle, name: row.username, avatarUrl: row.avatar_url }, body: row.body, createdAt: row.created_at.toISOString(), isMine: row.user_id === viewerId })),
    reactions: Object.fromEntries(gameReactions.rows.map((row) => [row.reaction, Number(row.n)])) as Partial<Record<LiveReaction, number>>,
    playReactions: plays,
    mine: mine.rows.map((row) => ({ playId: row.play_id, reaction: row.reaction })),
    viewers: topicViewers(gameTopic(league, eventId)),
  };
}

export async function postChat(userId: number, league: League, eventId: string, body: string): Promise<ChatMessage> {
  const text = clean(body).slice(0, 280);
  if (!text) throw new EmptyMessageError("Write a message first.");
  const inserted = await pool.query<{ id: string; created_at: Date }>(
    "INSERT INTO live_game_events(league, event_id, user_id, kind, body) VALUES($1,$2,$3,'chat',$4) RETURNING id, created_at", [league, eventId, userId, text]);
  const author = await pool.query<{ handle: string; username: string; avatar_url: string | null }>("SELECT p.handle, u.username, p.avatar_url FROM user_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1", [userId]);
  const message: ChatMessage = {
    id: Number(inserted.rows[0]!.id), author: { userId, handle: author.rows[0]?.handle ?? "", name: author.rows[0]?.username ?? "", avatarUrl: author.rows[0]?.avatar_url ?? null },
    body: text, createdAt: inserted.rows[0]!.created_at.toISOString(), isMine: true,
  };
  publishToTopic(gameTopic(league, eventId), "chat", { ...message, isMine: false });
  return message;
}

export class EmptyMessageError extends Error {}

/** One reaction per user, per kind, per play (or per 15 minutes for the game as a whole). */
export async function reactLive(userId: number, league: League, eventId: string, reaction: LiveReaction, playId: string | null): Promise<{ added: boolean }> {
  const existing = await pool.query(
    `SELECT 1 FROM live_game_events WHERE league=$1 AND event_id=$2 AND user_id=$3 AND kind='reaction' AND reaction=$4
       AND ${playId ? "play_id=$5" : "play_id IS NULL AND created_at > NOW() - INTERVAL '15 minutes'"}`,
    playId ? [league, eventId, userId, reaction, playId] : [league, eventId, userId, reaction]);
  if (existing.rowCount) return { added: false };
  await pool.query("INSERT INTO live_game_events(league, event_id, user_id, kind, reaction, play_id) VALUES($1,$2,$3,'reaction',$4,$5)", [league, eventId, userId, reaction, playId]);
  publishToTopic(gameTopic(league, eventId), "reaction", { reaction, playId, userId });
  return { added: true };
}

export async function deleteChat(userId: number, messageId: number): Promise<boolean> {
  const result = await pool.query("DELETE FROM live_game_events WHERE id=$1 AND user_id=$2 AND kind='chat' RETURNING league, event_id", [messageId, userId]);
  const row = result.rows[0] as { league: string; event_id: string } | undefined;
  if (row) publishToTopic(gameTopic(row.league, row.event_id), "chat_deleted", { id: messageId });
  return Boolean(row);
}
