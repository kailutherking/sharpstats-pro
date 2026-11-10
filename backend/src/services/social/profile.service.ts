import { pool } from "../../db/pool";
import { NotFoundError } from "../stats.service";
import { evaluateUser, levelFor } from "./gamification.service";
import { notify } from "./notification.service";
import { pickRecord, listPosts, type PickRecord, type PostView } from "./pick.service";

export function slugify(name: string): string {
  const base = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);
  return base.length >= 3 ? base : `bettor_${base}`.slice(0, 20);
}

/** Every user gets a profile with a unique handle the first time it's needed. */
export async function ensureProfile(userId: number): Promise<string> {
  const existing = await pool.query<{ handle: string }>("SELECT handle FROM user_profiles WHERE user_id=$1", [userId]);
  if (existing.rows[0]) return existing.rows[0].handle;
  const user = await pool.query<{ username: string }>("SELECT username FROM users WHERE id=$1", [userId]);
  if (!user.rows[0]) throw new NotFoundError("User not found");
  const base = slugify(user.rows[0].username);
  for (const candidate of [base, `${base}_${userId}`, `bettor_${userId}`]) {
    const inserted = await pool.query<{ handle: string }>("INSERT INTO user_profiles(user_id, handle) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING handle", [userId, candidate]);
    if (inserted.rows[0]) return inserted.rows[0].handle;
    const mine = await pool.query<{ handle: string }>("SELECT handle FROM user_profiles WHERE user_id=$1", [userId]);
    if (mine.rows[0]) return mine.rows[0].handle;
  }
  throw new Error("Could not create a profile handle");
}

const STREAK_MILESTONES = new Set([3, 7, 14, 30, 60, 100]);

/** Records today's visit (US Eastern date) and extends or resets the daily streak. */
export async function touchActivity(userId: number): Promise<{ streak: number }> {
  await ensureProfile(userId);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const result = await pool.query<{ streak_days: number }>(
    `UPDATE user_profiles SET
       streak_days = CASE WHEN last_active_date = $2::date - 1 THEN streak_days + 1 WHEN last_active_date = $2::date THEN streak_days ELSE 1 END,
       visit_days = CASE WHEN last_active_date = $2::date THEN visit_days ELSE visit_days + 1 END,
       best_streak = GREATEST(best_streak, CASE WHEN last_active_date = $2::date - 1 THEN streak_days + 1 WHEN last_active_date = $2::date THEN streak_days ELSE 1 END),
       last_active_date = $2::date
     WHERE user_id=$1
     RETURNING streak_days`,
    [userId, today],
  );
  return { streak: result.rows[0]?.streak_days ?? 1 };
}

export async function recordVisit(userId: number): Promise<void> {
  const before = await pool.query<{ last_active_date: string | null }>("SELECT last_active_date::text FROM user_profiles WHERE user_id=$1", [userId]);
  const { streak } = await touchActivity(userId);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  if (before.rows[0]?.last_active_date === today) return;
  if (STREAK_MILESTONES.has(streak)) {
    await notify([{ userId, type: "streak", title: `${streak}-day streak`, body: `You've opened SharpStats ${streak} days in a row. Keep it going tomorrow.`, dedupeKey: `streak:${today}` }]);
  }
  void evaluateUser(userId);
}

interface ProfileRow { user_id: number; handle: string; username: string; bio: string; avatar_url: string | null; favorite_sports: string[]; is_public: boolean; xp: number; streak_days: number; best_streak: number; onboarding_dismissed: boolean; created_at: Date }

async function profileRow(where: string, value: unknown): Promise<ProfileRow | null> {
  const result = await pool.query<ProfileRow>(
    `SELECT p.user_id, p.handle, u.username, p.bio, p.avatar_url, p.favorite_sports, p.is_public, p.xp, p.streak_days, p.best_streak, p.onboarding_dismissed, u.created_at
     FROM user_profiles p JOIN users u ON u.id=p.user_id WHERE ${where}`, [value]);
  return result.rows[0] ?? null;
}

export interface ProfileSummary { userId: number; handle: string; name: string; avatarUrl: string | null; level: number; rank: string }

export function summaryOf(row: Pick<ProfileRow, "user_id" | "handle" | "username" | "avatar_url" | "xp">): ProfileSummary {
  const level = levelFor(row.xp);
  return { userId: row.user_id, handle: row.handle, name: row.username, avatarUrl: row.avatar_url, level: level.level, rank: level.rank };
}

export interface PublicProfile extends ProfileSummary {
  bio: string;
  favoriteSports: string[];
  isPublic: boolean;
  joinedAt: string;
  streak: { days: number; best: number };
  xp: { total: number; current: number; next: number };
  followers: number;
  following: number;
  isFollowing: boolean;
  isMe: boolean;
  record: PickRecord;
  bySport: Array<{ sport: string; record: PickRecord }>;
  performance: Array<{ date: string; units: number }>;
  badges: Array<{ key: string; name: string; icon: string; earnedAt: string }>;
  favorites: { teams: Array<{ id: string; league: string; name: string; imageUrl: string | null }>; players: Array<{ id: string; league: string; name: string; imageUrl: string | null }>; sportsbooks: string[] };
  tailFade: { tails: number; fades: number; tailNetUnits: number; fadeNetUnits: number };
  recentPicks: PostView[];
}

export async function getProfile(viewerId: number, handle: string): Promise<PublicProfile> {
  await ensureProfile(viewerId);
  const row = await profileRow("p.handle=$1", handle.toLowerCase());
  if (!row || (!row.is_public && row.user_id !== viewerId)) throw new NotFoundError("Profile not found");
  const isMe = row.user_id === viewerId;
  const [counts, picks, badges, favorites, books, tailFade, recent] = await Promise.all([
    pool.query<{ followers: string; following: string; is_following: boolean }>(
      `SELECT (SELECT COUNT(*) FROM follows WHERE following_id=$1) AS followers, (SELECT COUNT(*) FROM follows WHERE follower_id=$1) AS following,
         EXISTS(SELECT 1 FROM follows WHERE follower_id=$2 AND following_id=$1) AS is_following`, [row.user_id, viewerId]),
    pool.query<{ sport: string | null; result: string; result_units: string | null; units: string | null; settled_at: Date | null; created_at: Date; locked: boolean; auto_graded: boolean }>(
      `SELECT sport, result, result_units::text, units::text, settled_at, created_at, locked, auto_graded FROM posts
       WHERE user_id=$1 AND kind='pick' AND (visibility='public' OR $2 OR (visibility='followers' AND EXISTS(SELECT 1 FROM follows WHERE follower_id=$3 AND following_id=$1)))
       ORDER BY COALESCE(settled_at, created_at)`, [row.user_id, isMe, viewerId]),
    pool.query<{ key: string; name: string; icon: string; earned_at: Date }>("SELECT b.key, b.name, b.icon, a.earned_at FROM achievements a JOIN badges b ON b.key=a.badge_key WHERE a.user_id=$1 ORDER BY b.sort_order", [row.user_id]),
    pool.query<{ entity_type: string; entity_id: string; league: string; name: string; image_url: string | null }>("SELECT entity_type, entity_id, league, name, image_url FROM favorite_stats WHERE user_id=$1 ORDER BY created_at DESC LIMIT 24", [row.user_id]),
    pool.query<{ name: string }>("SELECT s.name FROM favorite_sportsbooks f JOIN sportsbooks s ON s.id=f.sportsbook_id WHERE f.user_id=$1 ORDER BY s.name", [row.user_id]),
    pool.query<{ tails: string; fades: string; tail_units: string | null; fade_units: string | null }>(
      `SELECT COUNT(*) FILTER (WHERE r.reaction='tail') AS tails, COUNT(*) FILTER (WHERE r.reaction='fade') AS fades,
         SUM(p.result_units) FILTER (WHERE r.reaction='tail' AND p.result IN ('win','loss')) AS tail_units,
         SUM(-p.result_units) FILTER (WHERE r.reaction='fade' AND p.result IN ('win','loss')) AS fade_units
       FROM reactions r JOIN posts p ON p.id=r.post_id WHERE p.user_id=$1 AND r.user_id<>$1`, [row.user_id]),
    listPosts(viewerId, { authorId: row.user_id, kind: "pick", limit: 10 }),
  ]);
  const settled = picks.rows.map((pick) => ({ result: pick.result, resultUnits: pick.result_units === null ? null : Number(pick.result_units), units: pick.units === null ? null : Number(pick.units), locked: pick.locked, autoGraded: pick.auto_graded }));
  const sports = [...new Set(picks.rows.map((pick) => pick.sport ?? "Other"))];
  let running = 0;
  const performance = picks.rows.filter((pick) => pick.result !== "pending" && pick.result_units !== null).map((pick) => {
    running += Number(pick.result_units);
    return { date: (pick.settled_at ?? pick.created_at).toISOString(), units: Math.round(running * 100) / 100 };
  });
  const level = levelFor(row.xp);
  const c = counts.rows[0]!;
  const tf = tailFade.rows[0]!;
  return {
    ...summaryOf(row),
    bio: row.bio,
    favoriteSports: row.favorite_sports,
    isPublic: row.is_public,
    joinedAt: row.created_at.toISOString(),
    streak: { days: row.streak_days, best: row.best_streak },
    xp: { total: row.xp, current: level.current, next: level.next },
    followers: Number(c.followers),
    following: Number(c.following),
    isFollowing: c.is_following,
    isMe,
    record: pickRecord(settled),
    bySport: sports.map((sport) => ({ sport, record: pickRecord(picks.rows.map((pick, index) => ({ pick, item: settled[index]! })).filter(({ pick }) => (pick.sport ?? "Other") === sport).map(({ item }) => item)) })),
    performance,
    badges: badges.rows.map((badge) => ({ key: badge.key, name: badge.name, icon: badge.icon, earnedAt: badge.earned_at.toISOString() })),
    favorites: {
      teams: favorites.rows.filter((item) => item.entity_type === "team").map((item) => ({ id: item.entity_id, league: item.league, name: item.name, imageUrl: item.image_url })),
      players: favorites.rows.filter((item) => item.entity_type === "player").map((item) => ({ id: item.entity_id, league: item.league, name: item.name, imageUrl: item.image_url })),
      sportsbooks: books.rows.map((book) => book.name),
    },
    tailFade: { tails: Number(tf.tails), fades: Number(tf.fades), tailNetUnits: Math.round(Number(tf.tail_units ?? 0) * 100) / 100, fadeNetUnits: Math.round(Number(tf.fade_units ?? 0) * 100) / 100 },
    recentPicks: recent,
  };
}

export async function getMe(userId: number) {
  const handle = await ensureProfile(userId);
  const row = (await profileRow("p.user_id=$1", userId))!;
  const [unread, follows, picks, rules] = await Promise.all([
    pool.query<{ count: string }>("SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND read_at IS NULL", [userId]),
    pool.query<{ users: string; favorites: string }>("SELECT (SELECT COUNT(*) FROM follows WHERE follower_id=$1) AS users, (SELECT COUNT(*) FROM favorite_stats WHERE user_id=$1) AS favorites", [userId]),
    pool.query<{ count: string }>("SELECT COUNT(*) FROM posts WHERE user_id=$1 AND kind='pick'", [userId]),
    pool.query<{ count: string }>("SELECT COUNT(*) FROM odds_alert_rules WHERE user_id=$1", [userId]),
  ]);
  const level = levelFor(row.xp);
  return {
    ...summaryOf(row),
    handle,
    bio: row.bio,
    favoriteSports: row.favorite_sports,
    isPublic: row.is_public,
    streak: { days: row.streak_days, best: row.best_streak },
    xp: { total: row.xp, current: level.current, next: level.next },
    unreadNotifications: Number(unread.rows[0]?.count ?? 0),
    onboarding: {
      dismissed: row.onboarding_dismissed,
      steps: [
        { key: "profile", label: "Personalize your profile", done: Boolean(row.bio) || row.favorite_sports.length > 0 },
        { key: "follow", label: "Follow a team, player or bettor", done: Number(follows.rows[0]?.users ?? 0) + Number(follows.rows[0]?.favorites ?? 0) > 0 },
        { key: "alert", label: "Create an odds alert rule", done: Number(rules.rows[0]?.count ?? 0) > 0 },
        { key: "pick", label: "Share your first pick", done: Number(picks.rows[0]?.count ?? 0) > 0 },
      ],
    },
  };
}

export async function updateProfile(userId: number, changes: { handle?: string; bio?: string; avatarUrl?: string | null; favoriteSports?: string[]; isPublic?: boolean; onboardingDismissed?: boolean }) {
  await ensureProfile(userId);
  if (changes.handle) {
    const taken = await pool.query("SELECT 1 FROM user_profiles WHERE handle=$1 AND user_id<>$2", [changes.handle.toLowerCase(), userId]);
    if (taken.rowCount) throw new HandleTakenError("That handle is taken.");
  }
  await pool.query(
    `UPDATE user_profiles SET handle=COALESCE($2, handle), bio=COALESCE($3, bio), avatar_url=CASE WHEN $4::boolean THEN $5 ELSE avatar_url END,
       favorite_sports=COALESCE($6, favorite_sports), is_public=COALESCE($7, is_public), onboarding_dismissed=COALESCE($8, onboarding_dismissed), updated_at=NOW()
     WHERE user_id=$1`,
    [userId, changes.handle?.toLowerCase() ?? null, changes.bio ?? null, changes.avatarUrl !== undefined, changes.avatarUrl ?? null, changes.favoriteSports ?? null, changes.isPublic ?? null, changes.onboardingDismissed ?? null],
  );
  return getMe(userId);
}

export class HandleTakenError extends Error {}

export async function follow(userId: number, handle: string, enabled: boolean): Promise<{ following: boolean }> {
  await ensureProfile(userId);
  const target = await profileRow("p.handle=$1", handle.toLowerCase());
  if (!target || (!target.is_public && target.user_id !== userId)) throw new NotFoundError("Profile not found");
  if (target.user_id === userId) return { following: false };
  if (!enabled) {
    await pool.query("DELETE FROM follows WHERE follower_id=$1 AND following_id=$2", [userId, target.user_id]);
    return { following: false };
  }
  const inserted = await pool.query("INSERT INTO follows(follower_id, following_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [userId, target.user_id]);
  if (inserted.rowCount) {
    const me = (await profileRow("p.user_id=$1", userId))!;
    await notify([{ userId: target.user_id, type: "follower", title: `${me.username} followed you`, body: `@${me.handle} will see your public picks in their feed.`, link: { page: "Community", handle: me.handle }, dedupeKey: `follow:${userId}` }]);
  }
  return { following: true };
}

export async function followList(viewerId: number, handle: string, direction: "followers" | "following"): Promise<ProfileSummary[]> {
  const target = await profileRow("p.handle=$1", handle.toLowerCase());
  if (!target || (!target.is_public && target.user_id !== viewerId)) throw new NotFoundError("Profile not found");
  const rows = await pool.query<ProfileRow>(
    direction === "followers"
      ? `SELECT p.user_id, p.handle, u.username, p.avatar_url, p.xp FROM follows f JOIN user_profiles p ON p.user_id=f.follower_id JOIN users u ON u.id=p.user_id WHERE f.following_id=$1 AND p.is_public ORDER BY f.created_at DESC LIMIT 200`
      : `SELECT p.user_id, p.handle, u.username, p.avatar_url, p.xp FROM follows f JOIN user_profiles p ON p.user_id=f.following_id JOIN users u ON u.id=p.user_id WHERE f.follower_id=$1 AND p.is_public ORDER BY f.created_at DESC LIMIT 200`,
    [target.user_id],
  );
  return rows.rows.map(summaryOf);
}

export async function searchProfiles(query: string): Promise<ProfileSummary[]> {
  const q = `%${query.trim().toLowerCase().replace(/[%_]/g, "")}%`;
  const rows = await pool.query<ProfileRow>(
    `SELECT p.user_id, p.handle, u.username, p.avatar_url, p.xp FROM user_profiles p JOIN users u ON u.id=p.user_id
     WHERE p.is_public AND (p.handle LIKE $1 OR lower(u.username) LIKE $1) ORDER BY p.xp DESC LIMIT 20`, [q]);
  return rows.rows.map(summaryOf);
}
