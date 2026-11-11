import type { Response } from "express";

/**
 * Per-user realtime hub (Server-Sent Events). Each signed-in tab keeps one stream for personal
 * events (notifications) and optionally one per live game topic (chat, reactions). Sending happens
 * over normal authenticated POSTs, so one-way push is all the browser needs; SSE works through the
 * same auth, proxies and load balancers as the rest of the API.
 */

interface Client { res: Response; userId: number; topic: string | null; heartbeat: NodeJS.Timeout }

const clients = new Set<Client>();
const HEARTBEAT_MS = 20_000;
const MAX_PER_USER = 6;

function write(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Topic names: `game:<league>:<eventId>`. */
export const gameTopic = (league: string, eventId: string) => `game:${league}:${eventId}`;
export const TOPIC_PATTERN = /^game:(nba|nfl|mlb|nhl|ncaab):\d{1,14}$/;

export function openRealtime(res: Response, userId: number, topic: string | null): void {
  const mine = [...clients].filter((client) => client.userId === userId);
  if (mine.length >= MAX_PER_USER) {
    const oldest = mine[0]!;
    clearInterval(oldest.heartbeat);
    oldest.res.end();
    clients.delete(oldest);
  }
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write("retry: 5000\n\n");
  const client: Client = { res, userId, topic, heartbeat: setInterval(() => write(res, "heartbeat", { at: new Date().toISOString() }), HEARTBEAT_MS) };
  client.heartbeat.unref?.();
  clients.add(client);
  write(res, "ready", { topic, at: new Date().toISOString() });
  if (topic) publishToTopic(topic, "presence", { viewers: topicViewers(topic) });
  res.on("close", () => {
    clearInterval(client.heartbeat);
    clients.delete(client);
    if (topic) publishToTopic(topic, "presence", { viewers: topicViewers(topic) });
  });
}

/** Personal events go to the user's topic-less streams. */
export function publishToUser(userId: number, event: string, data: unknown): void {
  for (const client of clients) if (client.userId === userId && client.topic === null) write(client.res, event, data);
}

export function publishToTopic(topic: string, event: string, data: unknown): void {
  for (const client of clients) if (client.topic === topic) write(client.res, event, data);
}

export function topicViewers(topic: string): number {
  return new Set([...clients].filter((client) => client.topic === topic).map((client) => client.userId)).size;
}

export function closeRealtime(): void {
  for (const client of clients) {
    clearInterval(client.heartbeat);
    client.res.end();
  }
  clients.clear();
}
