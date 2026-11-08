import type { Response } from "express";
import type { OddsSport } from "./oddsCatalog";

/**
 * Server-Sent Events hub. The browser keeps one stream open per sport and is told the moment a
 * refresh lands (new prices, movements, alerts) instead of waiting for its next poll. Upstream
 * providers are REST-only, so the server polls them and pushes changes downstream.
 */

interface Client { res: Response; sport: OddsSport; userId: number; heartbeat: NodeJS.Timeout }

const clients = new Set<Client>();
const HEARTBEAT_MS = 20_000;
const MAX_CLIENTS_PER_USER = 4;

function write(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function openStream(res: Response, sport: OddsSport, userId: number, onClose: () => void): void {
  const existing = [...clients].filter((client) => client.userId === userId);
  if (existing.length >= MAX_CLIENTS_PER_USER) {
    const oldest = existing[0]!;
    oldest.res.end();
    clearInterval(oldest.heartbeat);
    clients.delete(oldest);
  }
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write("retry: 5000\n\n");
  const client: Client = {
    res,
    sport,
    userId,
    heartbeat: setInterval(() => write(res, "heartbeat", { at: new Date().toISOString() }), HEARTBEAT_MS),
  };
  client.heartbeat.unref?.();
  clients.add(client);
  write(res, "ready", { sport, at: new Date().toISOString() });
  res.on("close", () => {
    clearInterval(client.heartbeat);
    clients.delete(client);
    onClose();
  });
}

export function broadcast(sport: OddsSport, event: string, data: unknown): void {
  for (const client of clients) if (client.sport === sport) write(client.res, event, data);
}

export function streamClients(sport?: OddsSport): number {
  return sport ? [...clients].filter((client) => client.sport === sport).length : clients.size;
}

export function closeAllStreams(): void {
  for (const client of clients) {
    clearInterval(client.heartbeat);
    client.res.end();
  }
  clients.clear();
}
