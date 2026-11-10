import { pool } from "../../db/pool";
import { NotFoundError } from "../stats.service";
import { evaluateUser } from "./gamification.service";
import { addFeedEvent } from "./feed.service";
import { notify } from "./notification.service";
import { publishToUser } from "./realtime.service";

export const REACTIONS = ["like", "fire", "lock", "tail", "fade"] as const;
export type Reaction = typeof REACTIONS[number];
export type Visibility = "public" | "followers" | "private";

export interface PickRecord { picks: number; settled: number; wins: number; losses: number; pushes: number; pending: number; units: number; risked: number; roi: number | null; winRate: number | null; verified: number }

/** W-L-P, units won and ROI (units won ÷ units risked) for a set of picks. */
export function pickRecord(picks: Array<{ result: string; resultUnits: number | null; units: number | null; locked?: boolean; autoGraded?: boolean }>): PickRecord {
  const settled = picks.filter((pick) => pick.result !== "pending");
  const wins = settled.filter((pick) => pick.result === "win").length;
  const losses = settled.filter((pick) => pick.result === "loss").length;
  const units = settled.reduce((total, pick) => total + (pick.resultUnits ?? 0), 0);
  const risked = settled.filter((pick) => pick.result !== "push").reduce((total, pick) => total + (pick.units ?? 1), 0);
  return {
    picks: picks.length, settled: settled.length, wins, losses, pushes: settled.length - wins - losses, pending: picks.length - settled.length,
    units: Math.round(units * 100) / 100, risked: Math.round(risked * 100) / 100,
    roi: risked > 0 ? Math.round((units / risked) * 10000) / 10000 : null,
    winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 10000) / 10000 : null,
    verified: settled.filter((pick) => pick.locked && pick.autoGraded).length,
  };
}

/** Units won or lost for a settled pick at the odds it was shared at. */
export function resultUnits(result: string, odds: number, units: number): number | null {
  if (result === "win") return Math.round(units * (odds - 1) * 100) / 100;
  if (result === "loss") return -units;
  if (result === "push") return 0;
  return null;
}

export interface PostView {
  id: number;
  kind: "pick" | "post";
  author: { userId: number; handle: string; name: string; avatarUrl: string | null; xp: number };
  body: string;
  visibility: Visibility;
  createdAt: string;
  pick: null | {
    sport: string | null; league: string | null; event: string | null; eventId: string | null; market: string | null; betType: string | null; selection: string | null;
    line: number | null; odds: number | null; units: number | null; sportsbook: string | null; eventStart: string | null; locked: boolean;
    result: "pending" | "win" | "loss" | "push"; resultUnits: number | null; autoGraded: boolean; settledAt: string | null;
  };
  reactions: Record<Reaction, number>;
  mine: Reaction[];
  comments: number;
  isMine: boolean;
}

interface PostRow {
  id: string; kind: "pick" | "post"; user_id: number; handle: string; username: string; avatar_url: string | null; xp: number; body: string; visibility: Visibility; created_at: Date;
  sport: string | null; league: string | null; event: string | null; event_id: string | null; market_key: string | null; bet_type: string | null; selection: string | null;
  line_value: string | null; odds: string | null; units: string | null; sportsbook: string | null; event_start: Date | null; locked: boolean; result: "pending" | "win" | "loss" | "push";
  result_units: string | null; auto_graded: boolean; settled_at: Date | null; reaction_counts: Record<string, number> | null; my_reactions: string[] | null; comment_count: string;
}

const num = (value: string | null) => (value === null ? null : Number(value));

function view(row: PostRow, viewerId: number): PostView {
  const counts = row.reaction_counts ?? {};
  return {
    id: Number(row.id), kind: row.kind,
    author: { userId: row.user_id, handle: row.handle, name: row.username, avatarUrl: row.avatar_url, xp: row.xp },
    body: row.body, visibility: row.visibility, createdAt: row.created_at.toISOString(),
    pick: row.kind === "pick" ? {
      sport: row.sport, league: row.league, event: row.event, eventId: row.event_id, market: row.market_key, betType: row.bet_type, selection: row.selection,
      line: num(row.line_value), odds: num(row.odds), units: num(row.units), sportsbook: row.sportsbook, eventStart: row.event_start?.toISOString() ?? null, locked: row.locked,
      result: row.result, resultUnits: num(row.result_units), autoGraded: row.auto_graded, settledAt: row.settled_at?.toISOString() ?? null,
    } : null,
    reactions: Object.fromEntries(REACTIONS.map((reaction) => [reaction, Number(counts[reaction] ?? 0)])) as Record<Reaction, number>,
    mine: (row.my_reactions ?? []) as Reaction[],
    comments: Number(row.comment_count),
    isMine: row.user_id === viewerId,
  };
}

/** Visibility rule shared by every post query: public, mine, or followers-only from someone I follow. */
const VISIBLE = `(p.visibility='public' OR p.user_id=$1 OR (p.visibility='followers' AND EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=p.user_id)))
  AND (pr.is_public OR p.user_id=$1)`;

const SELECT_POSTS = `
  SELECT p.*, pr.handle, u.username, pr.avatar_url, pr.xp,
    (SELECT jsonb_object_agg(reaction, n) FROM (SELECT reaction, COUNT(*) AS n FROM reactions WHERE post_id=p.id GROUP BY reaction) rc) AS reaction_counts,
    (SELECT array_agg(reaction) FROM reactions WHERE post_id=p.id AND user_id=$1) AS my_reactions,
    (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comment_count
  FROM posts p JOIN user_profiles pr ON pr.user_id=p.user_id JOIN users u ON u.id=p.user_id`;

export type PickSort = "recent" | "popular" | "tailed" | "props" | "winners" | "sharp";

export async function listPosts(viewerId: number, options: { authorId?: number; scope?: "following" | "all"; kind?: "pick" | "post"; sort?: PickSort; limit?: number; before?: string; ids?: number[] }): Promise<PostView[]> {
  const params: unknown[] = [viewerId];
  const where = [VISIBLE];
  if (options.authorId) { params.push(options.authorId); where.push(`p.user_id=$${params.length}`); }
  if (options.ids) { params.push(options.ids); where.push(`p.id = ANY($${params.length}::bigint[])`); }
  if (options.scope === "following") where.push("(p.user_id=$1 OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=p.user_id))");
  if (options.kind) { params.push(options.kind); where.push(`p.kind=$${params.length}`); }
  if (options.before) { params.push(options.before); where.push(`p.created_at < $${params.length}`); }
  let order = "p.created_at DESC";
  const sort = options.sort ?? "recent";
  if (sort === "popular") { where.push("p.created_at > NOW() - INTERVAL '3 days'"); order = "(SELECT COUNT(*) FROM reactions r WHERE r.post_id=p.id) + (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) DESC, p.created_at DESC"; }
  if (sort === "tailed") { where.push("p.kind='pick' AND p.created_at > NOW() - INTERVAL '7 days'"); order = "(SELECT COUNT(*) FROM reactions r WHERE r.post_id=p.id AND r.reaction='tail') DESC, p.created_at DESC"; }
  if (sort === "props") { where.push("p.kind='pick' AND p.result='pending' AND (p.market_key ~ '^(player_|batter_|pitcher_)' OR p.bet_type ILIKE '%prop%')"); order = "(SELECT COUNT(*) FROM reactions r WHERE r.post_id=p.id) DESC, p.created_at DESC"; }
  if (sort === "winners") { where.push("p.kind='pick' AND p.result='win' AND p.settled_at > NOW() - INTERVAL '7 days'"); order = "p.result_units DESC NULLS LAST"; }
  if (sort === "sharp") {
    // Pending picks from bettors with a winning verified-style record (10+ settled picks, positive units).
    where.push(`p.kind='pick' AND p.result='pending' AND p.user_id IN (SELECT user_id FROM posts WHERE kind='pick' AND result IN ('win','loss','push') GROUP BY user_id HAVING COUNT(*) >= 10 AND SUM(result_units) > 0)`);
  }
  params.push(Math.min(options.limit ?? 30, 100));
  const rows = await pool.query<PostRow>(`${SELECT_POSTS} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT $${params.length}`, params);
  return rows.rows.map((row) => view(row, viewerId));
}

export async function getPost(viewerId: number, postId: number): Promise<PostView> {
  const [post] = await listPosts(viewerId, { ids: [postId], limit: 1 });
  if (!post) throw new NotFoundError("Post not found");
  return post;
}

async function followersOf(userId: number): Promise<number[]> {
  return (await pool.query<{ follower_id: number }>("SELECT follower_id FROM follows WHERE following_id=$1", [userId])).rows.map((row) => row.follower_id);
}

async function authorName(userId: number): Promise<{ name: string; handle: string }> {
  const row = await pool.query<{ username: string; handle: string }>("SELECT u.username, p.handle FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1", [userId]);
  return { name: row.rows[0]?.username ?? "A bettor", handle: row.rows[0]?.handle ?? "" };
}

/**
 * Shares a tracked bet as a pick. The pick snapshots odds, line and size (in units, never dollars),
 * and is "locked" when shared before the game's start time on the odds board.
 */
export async function sharePick(userId: number, betId: number, input: { body: string; visibility: Visibility }): Promise<PostView> {
  const bet = await pool.query<{ id: number; sport: string; league: string; event: string; event_id: string | null; market_key: string; bet_type: string; selection: string; team_player: string; line_value: string | null; odds: string; stake: string; sportsbook: string; result: string; graded_at: Date | null; unit_size: string | null; commence_time: Date | null; espn_start: Date | null }>(
    `SELECT b.*, br.unit_size,
       (SELECT commence_time FROM odds_games g WHERE g.id=b.event_id) AS commence_time,
       (SELECT start_time FROM games g WHERE g.odds_game_id=b.event_id LIMIT 1) AS espn_start
     FROM bets b LEFT JOIN bankroll br ON br.user_id=b.user_id WHERE b.id=$1 AND b.user_id=$2`, [betId, userId]);
  const row = bet.rows[0];
  if (!row) throw new NotFoundError("Bet not found");
  // Only open bets can become picks, so records can't be padded by sharing wins after the fact.
  if (row.result !== "pending") throw new AlreadySharedError("Only pending bets can be shared as picks.");
  const existing = await pool.query<{ id: string }>("SELECT id FROM posts WHERE bet_id=$1", [betId]);
  if (existing.rows[0]) throw new AlreadySharedError("This bet is already shared.");
  const units = Math.max(0.1, Math.round((Number(row.stake) / Math.max(1, Number(row.unit_size ?? 25))) * 100) / 100);
  const start = row.commence_time ?? row.espn_start;
  const locked = Boolean(start && start.getTime() > Date.now() && row.result === "pending");
  const settledUnits = resultUnits(row.result, Number(row.odds), units);
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO posts(user_id, kind, body, visibility, bet_id, sport, league, event, event_id, market_key, bet_type, selection, line_value, odds, units, sportsbook, event_start, locked, result, result_units, auto_graded, settled_at)
     VALUES($1,'pick',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
    [userId, input.body, input.visibility, betId, row.sport, row.league, row.event, row.event_id, row.market_key, row.bet_type, row.selection || row.team_player, row.line_value, row.odds, units,
      row.sportsbook, start, locked, row.result, settledUnits, false, row.result === "pending" ? null : new Date()],
  );
  const postId = Number(inserted.rows[0]!.id);
  if (input.visibility !== "private") {
    const author = await authorName(userId);
    const followers = await followersOf(userId);
    await notify(followers.map((follower) => ({ userId: follower, type: "following_pick" as const, title: `${author.name} shared a pick`, body: `${row.selection || row.team_player || row.event} @ ${Number(row.odds).toFixed(2)} · ${units}u`, link: { page: "Community", postId }, dedupeKey: `pick:${postId}` })));
  }
  void evaluateUser(userId);
  return getPost(userId, postId);
}

export class AlreadySharedError extends Error {}

export async function createPost(userId: number, input: { body: string; visibility: Visibility }): Promise<PostView> {
  const inserted = await pool.query<{ id: string }>("INSERT INTO posts(user_id, kind, body, visibility) VALUES($1,'post',$2,$3) RETURNING id", [userId, input.body, input.visibility]);
  return getPost(userId, Number(inserted.rows[0]!.id));
}

export async function deletePost(userId: number, postId: number): Promise<boolean> {
  const result = await pool.query("DELETE FROM posts WHERE id=$1 AND user_id=$2", [postId, userId]);
  return (result.rowCount ?? 0) > 0;
}

export async function react(userId: number, postId: number, reaction: Reaction, enabled: boolean): Promise<PostView> {
  const post = await getPost(userId, postId);
  if (!enabled) {
    await pool.query("DELETE FROM reactions WHERE post_id=$1 AND user_id=$2 AND reaction=$3", [postId, userId, reaction]);
    return getPost(userId, postId);
  }
  // Tail and fade are opposites; choosing one clears the other.
  if (reaction === "tail" || reaction === "fade") await pool.query("DELETE FROM reactions WHERE post_id=$1 AND user_id=$2 AND reaction=$3", [postId, userId, reaction === "tail" ? "fade" : "tail"]);
  const inserted = await pool.query("INSERT INTO reactions(post_id, user_id, reaction) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [postId, userId, reaction]);
  if (inserted.rowCount && post.author.userId !== userId) {
    const me = await authorName(userId);
    const verb = { like: "liked", fire: "reacted 🔥 to", lock: "called a lock on", tail: "tailed", fade: "faded" }[reaction];
    await notify([{ userId: post.author.userId, type: "reaction", title: `${me.name} ${verb} your ${post.kind}`, body: post.pick?.selection ?? post.body.slice(0, 120), link: { page: "Community", postId }, dedupeKey: `reaction:${postId}:${userId}:${reaction}` }]);
    void evaluateUser(post.author.userId);
  }
  const updated = await getPost(userId, postId);
  publishToUser(post.author.userId, "post", { id: postId, reactions: updated.reactions, comments: updated.comments });
  return updated;
}

export interface CommentView { id: number; postId: number; author: { userId: number; handle: string; name: string; avatarUrl: string | null }; body: string; createdAt: string; isMine: boolean }

export async function listComments(viewerId: number, postId: number): Promise<CommentView[]> {
  await getPost(viewerId, postId);
  const rows = await pool.query<{ id: string; user_id: number; handle: string; username: string; avatar_url: string | null; body: string; created_at: Date }>(
    `SELECT c.id, c.user_id, p.handle, u.username, p.avatar_url, c.body, c.created_at FROM comments c JOIN user_profiles p ON p.user_id=c.user_id JOIN users u ON u.id=c.user_id
     WHERE c.post_id=$1 ORDER BY c.created_at LIMIT 200`, [postId]);
  return rows.rows.map((row) => ({ id: Number(row.id), postId, author: { userId: row.user_id, handle: row.handle, name: row.username, avatarUrl: row.avatar_url }, body: row.body, createdAt: row.created_at.toISOString(), isMine: row.user_id === viewerId }));
}

export async function addComment(userId: number, postId: number, body: string): Promise<CommentView> {
  const post = await getPost(userId, postId);
  const inserted = await pool.query<{ id: string }>("INSERT INTO comments(post_id, user_id, body) VALUES($1,$2,$3) RETURNING id", [postId, userId, body]);
  if (post.author.userId !== userId) {
    const me = await authorName(userId);
    await notify([{ userId: post.author.userId, type: "comment", title: `${me.name} commented on your ${post.kind}`, body: body.slice(0, 200), link: { page: "Community", postId }, dedupeKey: `comment:${inserted.rows[0]!.id}` }]);
    void evaluateUser(post.author.userId);
  }
  const comments = await listComments(userId, postId);
  return comments.find((comment) => comment.id === Number(inserted.rows[0]!.id))!;
}

export async function deleteComment(userId: number, commentId: number): Promise<boolean> {
  const result = await pool.query("DELETE FROM comments WHERE id=$1 AND user_id=$2", [commentId, userId]);
  return (result.rowCount ?? 0) > 0;
}

const isProp = (market: string | null, betType: string | null) => /^(player_|batter_|pitcher_)/.test(market ?? "") || /prop/i.test(betType ?? "");

/**
 * Called whenever a bet's result changes (manual edit or automatic grading). Updates the shared
 * pick, tells the owner (prop hit / bet result), posts big wins to the feed and re-checks badges.
 */
export async function onBetSettled(userId: number, betId: number, source: "manual" | "grader"): Promise<void> {
  try {
    const bet = await pool.query<{ result: string; odds: string; stake: string; profit_loss: string; event: string; selection: string; team_player: string; market_key: string; bet_type: string; league: string; unit_size: string | null }>(
      "SELECT b.result, b.odds, b.stake, b.profit_loss, b.event, b.selection, b.team_player, b.market_key, b.bet_type, b.league, br.unit_size FROM bets b LEFT JOIN bankroll br ON br.user_id=b.user_id WHERE b.id=$1 AND b.user_id=$2",
      [betId, userId]);
    const row = bet.rows[0];
    if (!row) return;
    const post = await pool.query<{ id: string; odds: string; units: string; result: string; visibility: Visibility }>("SELECT id, odds::text, units::text, result, visibility FROM posts WHERE bet_id=$1", [betId]);
    const pick = post.rows[0];
    const label = row.selection || row.team_player || row.event;
    const changed = !pick || pick.result !== row.result;
    if (pick && changed) {
      const units = resultUnits(row.result, Number(pick.odds), Number(pick.units));
      await pool.query("UPDATE posts SET result=$2::text, result_units=$3, auto_graded=$4, settled_at=CASE WHEN $2::text='pending' THEN NULL ELSE NOW() END WHERE id=$1",
        [pick.id, row.result, units, source === "grader"]);
      if (row.result === "win" && pick.visibility !== "private" && units !== null && (units >= 3 || Number(pick.odds) >= 3)) {
        const author = await authorName(userId);
        await addFeedEvent({ type: "big_win", actorUserId: userId, title: `cashed ${label} for +${units}u`, body: `${row.event} @ ${Number(pick.odds).toFixed(2)}`, ref: { postId: Number(pick.id), handle: author.handle }, dedupeKey: `bigwin:${pick.id}` });
      }
    }
    if (changed && row.result !== "pending") {
      const units = Number(row.profit_loss) / Math.max(1, Number(row.unit_size ?? 25));
      const prop = isProp(row.market_key, row.bet_type);
      await notify([{
        userId,
        type: prop && row.result === "win" ? "prop_hit" : "bet_result",
        title: prop && row.result === "win" ? `Prop hit: ${label}` : `Bet ${row.result === "win" ? "won" : row.result === "loss" ? "lost" : "pushed"}: ${label}`,
        body: `${row.event} · ${units >= 0 ? "+" : ""}${units.toFixed(2)}u`,
        link: { page: "Bet tracker" },
        dedupeKey: `bet:${betId}:${row.result}`,
      }]);
    }
    void evaluateUser(userId);
  } catch (error) {
    console.warn("Pick settlement update failed", error instanceof Error ? error.message : error);
  }
}
