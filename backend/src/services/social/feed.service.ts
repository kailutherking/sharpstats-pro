import { pool } from "../../db/pool";
import type { League } from "../../providers/espnStats";
import { cached } from "../statsCache";
import type { PostView } from "./pick.service";

export interface FeedEventDraft { type: string; actorUserId?: number | null; league?: string | null; title: string; body?: string; ref?: Record<string, unknown>; dedupeKey?: string }

export async function addFeedEvent(draft: FeedEventDraft): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO feed_events(type, actor_user_id, league, title, body, ref, dedupe_key) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [draft.type, draft.actorUserId ?? null, draft.league ?? null, draft.title.slice(0, 200), (draft.body ?? "").slice(0, 600), JSON.stringify(draft.ref ?? {}), draft.dedupeKey ?? null],
    );
  } catch (error) {
    console.warn("Feed event write failed", error instanceof Error ? error.message : error);
  }
}

export async function pruneFeedEvents(): Promise<void> {
  await pool.query("DELETE FROM feed_events WHERE created_at < NOW() - INTERVAL '30 days'").catch(() => undefined);
}

export interface NewsItem { id: string; league: League; headline: string; description: string | null; published: string; link: string | null; image: string | null; category: "news" | "trade" }

const PATHS: Record<League, string> = { nba: "basketball/nba", nfl: "football/nfl", mlb: "baseball/mlb", nhl: "hockey/nhl", ncaab: "basketball/mens-college-basketball" };
const SITE_API = (process.env.ESPN_SITE_API_URL ?? "https://site.api.espn.com").replace(/\/+$/, "");
const TRADE_WORDS = /\b(trade[sd]?|acquire[sd]?|deal|sign(s|ed|ing)?|waive[sd]?|release[sd]?|extension|claimed)\b/i;

/** League headlines from ESPN (cached 10 minutes). Trade and signing stories are tagged "trade". */
export async function leagueNews(league: League): Promise<NewsItem[]> {
  const result = await cached(`news:${league}`, 10 * 60_000, async () => {
    const response = await fetch(`${SITE_API}/apis/site/v2/sports/${PATHS[league]}/news?limit=25`, { headers: { Accept: "application/json", "User-Agent": "SharpStatsPro/1.6 (+news)" }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`News request failed (${response.status})`);
    const payload = await response.json() as { articles?: Array<Record<string, unknown>> };
    return (payload.articles ?? []).map((article): NewsItem | null => {
      const headline = typeof article.headline === "string" ? article.headline : null;
      if (!headline) return null;
      const links = article.links as { web?: { href?: string } } | undefined;
      const images = article.images as Array<{ url?: string }> | undefined;
      const description = typeof article.description === "string" ? article.description : null;
      return {
        id: String(article.id ?? headline), league, headline, description,
        published: typeof article.published === "string" ? article.published : new Date().toISOString(),
        link: links?.web?.href ?? null, image: images?.[0]?.url ?? null,
        category: TRADE_WORDS.test(`${headline} ${description ?? ""}`) ? "trade" : "news",
      };
    }).filter((item): item is NewsItem => Boolean(item));
  }).catch(() => null);
  return result?.data ?? [];
}

/* ---------- Feed composition ---------- */


export type FeedFilter = "all" | "picks" | "wins" | "news" | "injuries" | "market";
export interface FeedEventView { id: number; type: string; league: string | null; title: string; body: string; ref: Record<string, unknown>; actor: { handle: string; name: string; avatarUrl: string | null } | null; createdAt: string }
export type FeedItem = { kind: "post"; at: string; post: PostView } | { kind: "event"; at: string; event: FeedEventView } | { kind: "news"; at: string; news: NewsItem };

const LEAGUES: League[] = ["nba", "nfl", "mlb", "nhl", "ncaab"];

/**
 * Home feed: picks and posts (people you follow, or everyone), big wins and badges, injury news
 * for players and teams you follow, sharp market moves and league headlines.
 */
export async function getFeed(viewerId: number, options: { scope: "following" | "all"; filter: FeedFilter; league?: League; limit?: number }): Promise<FeedItem[]> {
  const { listPosts } = await import("./pick.service");
  const limit = options.limit ?? 40;
  const want = (filter: FeedFilter) => options.filter === "all" || options.filter === filter;
  const profile = await pool.query<{ favorite_sports: string[] }>("SELECT favorite_sports FROM user_profiles WHERE user_id=$1", [viewerId]);
  const sports = (profile.rows[0]?.favorite_sports ?? []).filter((sport): sport is League => (LEAGUES as string[]).includes(sport));
  const leagues = options.league ? [options.league] : sports.length ? sports : LEAGUES;

  const [posts, events, news] = await Promise.all([
    want("picks") ? listPosts(viewerId, { scope: options.scope, limit }) : Promise.resolve([] as PostView[]),
    pool.query<{ id: string; type: string; league: string | null; title: string; body: string; ref: Record<string, unknown>; created_at: Date; handle: string | null; username: string | null; avatar_url: string | null }>(
      `SELECT e.id, e.type, e.league, e.title, e.body, e.ref, e.created_at, p.handle, u.username, p.avatar_url
       FROM feed_events e LEFT JOIN user_profiles p ON p.user_id=e.actor_user_id LEFT JOIN users u ON u.id=e.actor_user_id
       WHERE e.created_at > NOW() - INTERVAL '7 days'
         AND (e.actor_user_id IS NULL OR (COALESCE(p.is_public, FALSE) OR e.actor_user_id=$1))
         AND e.type = ANY($2::text[])
         AND (e.league IS NULL OR e.league = ANY($3::text[]))
         AND (
           e.type IN ('market')
           OR (e.type = 'injury' AND ($4 = 'all' OR EXISTS (SELECT 1 FROM favorite_stats f WHERE f.user_id=$1 AND f.league=e.league AND
                 ((f.entity_type='player' AND f.entity_id = e.ref->>'athleteId') OR (f.entity_type='team' AND f.entity_id = e.ref->>'teamId')))))
           OR (e.type IN ('big_win','achievement') AND ($4 = 'all' OR e.actor_user_id=$1 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=e.actor_user_id)))
         )
       ORDER BY e.created_at DESC LIMIT $5`,
      [viewerId, [...(want("wins") ? ["big_win", "achievement"] : []), ...(want("injuries") ? ["injury"] : []), ...(want("market") ? ["market"] : [])], leagues, options.scope, limit],
    ),
    want("news") ? Promise.all(leagues.map(leagueNews)).then((lists) => lists.flat()) : Promise.resolve([] as NewsItem[]),
  ]);
  const items: FeedItem[] = [
    ...posts.map((post): FeedItem => ({ kind: "post", at: post.createdAt, post })),
    ...events.rows.map((row): FeedItem => ({
      kind: "event", at: row.created_at.toISOString(),
      event: { id: Number(row.id), type: row.type, league: row.league, title: row.title, body: row.body, ref: row.ref, actor: row.handle ? { handle: row.handle, name: row.username ?? row.handle, avatarUrl: row.avatar_url } : null, createdAt: row.created_at.toISOString() },
    })),
    ...news.slice(0, options.filter === "news" ? 60 : 12).map((item): FeedItem => ({ kind: "news", at: item.published, news: item })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
