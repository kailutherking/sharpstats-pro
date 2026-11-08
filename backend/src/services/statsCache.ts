import { pool } from "../db/pool";

/**
 * Two-level cache for provider data: an in-process map, backed by the `stats_cache` table so
 * a restart does not force a cold provider fetch. Concurrent requests for the same key share
 * one provider call. When a provider fails, the last good copy is served and marked stale.
 */
interface Entry {
  data: unknown;
  fetchedAt: number;
  expiresAt: number;
}

export interface Cached<T> {
  data: T;
  fetchedAt: Date;
  stale: boolean;
}

const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();
const MAX_MEMORY_ENTRIES = 600;

function remember(key: string, entry: Entry) {
  memory.delete(key);
  memory.set(key, entry);
  while (memory.size > MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

async function readPersisted(key: string): Promise<Entry | null> {
  try {
    const result = await pool.query<{ payload: unknown; fetched_at: Date; expires_at: Date }>(
      "SELECT payload, fetched_at, expires_at FROM stats_cache WHERE cache_key=$1",
      [key],
    );
    const row = result.rows[0];
    return row ? { data: row.payload, fetchedAt: row.fetched_at.getTime(), expiresAt: row.expires_at.getTime() } : null;
  } catch (error) {
    console.warn("Stats cache read failed", key, error instanceof Error ? error.message : error);
    return null;
  }
}

async function writePersisted(key: string, entry: Entry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO stats_cache(cache_key, payload, fetched_at, expires_at) VALUES($1,$2,$3,$4)
       ON CONFLICT (cache_key) DO UPDATE SET payload=EXCLUDED.payload, fetched_at=EXCLUDED.fetched_at, expires_at=EXCLUDED.expires_at`,
      [key, JSON.stringify(entry.data), new Date(entry.fetchedAt), new Date(entry.expiresAt)],
    );
  } catch (error) {
    console.warn("Stats cache write failed", key, error instanceof Error ? error.message : error);
  }
}

export interface CacheOptions {
  /** Skip fresh cached copies and call the provider. */
  force?: boolean;
  /** Also store the result in PostgreSQL. */
  persist?: boolean;
}

export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>, options: CacheOptions = {}): Promise<Cached<T>> {
  const now = Date.now();
  if (!options.force) {
    const hit = memory.get(key);
    if (hit && hit.expiresAt > now) return { data: hit.data as T, fetchedAt: new Date(hit.fetchedAt), stale: false };
    if (options.persist && !hit) {
      const stored = await readPersisted(key);
      if (stored) {
        remember(key, stored);
        if (stored.expiresAt > now) return { data: stored.data as T, fetchedAt: new Date(stored.fetchedAt), stale: false };
      }
    }
  }
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const data = await fetcher();
      const fetchedAt = Date.now();
      const entry: Entry = { data, fetchedAt, expiresAt: fetchedAt + ttlMs };
      remember(key, entry);
      if (options.persist) await writePersisted(key, entry);
      return entry;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  try {
    const entry = await pending;
    return { data: entry.data as T, fetchedAt: new Date(entry.fetchedAt), stale: false };
  } catch (error) {
    const fallback = memory.get(key) ?? (options.persist ? await readPersisted(key) : null);
    if (fallback) {
      console.warn("Serving stale stats after provider failure", key, error instanceof Error ? error.message : error);
      return { data: fallback.data as T, fetchedAt: new Date(fallback.fetchedAt), stale: true };
    }
    throw error;
  }
}

/** Removes cached entries whose key starts with the prefix (memory only). */
export function invalidate(prefix: string): void {
  for (const key of [...memory.keys()]) if (key.startsWith(prefix)) memory.delete(key);
}

export function clearStatsCache(): void {
  memory.clear();
  inflight.clear();
}
