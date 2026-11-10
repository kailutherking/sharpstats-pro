import { pool } from "../../db/pool";
import { notify } from "./notification.service";
import { addFeedEvent } from "./feed.service";

export interface BadgeDef { key: string; name: string; description: string; icon: string; xp: number }
export interface BadgeProgress extends BadgeDef { earned: boolean; earnedAt: string | null; progress: number; target: number; detail: string }

export const RANKS = [
  { min: 1, name: "Rookie" }, { min: 5, name: "Contender" }, { min: 10, name: "Pro" }, { min: 15, name: "Sharp" }, { min: 25, name: "Legend" },
] as const;

/** Level n needs 50·n·(n−1) XP: 100 for level 2, 300 for 3, 600 for 4… */
export function levelFor(xp: number): { level: number; rank: string; current: number; next: number } {
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * Math.max(0, xp)) / 100)) / 2));
  const floor = 50 * level * (level - 1);
  const next = 50 * (level + 1) * level;
  const rank = [...RANKS].reverse().find((item) => level >= item.min)!.name;
  return { level, rank, current: xp - floor, next: next - floor };
}

export interface BettingFacts {
  bets: number; settled: number; wins: number; staked: number; profit: number;
  longestWinStreak: number; currentWinStreak: number;
  closingTracked: number; beatClosing: number;
  propSettled: number; propWins: number;
  books: number; hedgedPairs: number;
  picks: number; tailsReceived: number; reactionsReceived: number; commentsReceived: number;
  visitDays: number; bestVisitStreak: number;
}

export const XP_RULES = { bet: 5, settled: 5, win: 10, pick: 10, reaction: 2, comment: 2, visit: 5 } as const;

export function xpFrom(facts: BettingFacts, badgeXp: number): number {
  return facts.bets * XP_RULES.bet + facts.settled * XP_RULES.settled + facts.wins * XP_RULES.win + facts.picks * XP_RULES.pick
    + facts.reactionsReceived * XP_RULES.reaction + facts.commentsReceived * XP_RULES.comment + facts.visitDays * XP_RULES.visit + badgeXp;
}

const pct = (value: number) => `${(value * 100).toFixed(0)}%`;

/** Progress toward each badge from the user's tracked bets, picks and activity. */
export function badgeProgress(facts: BettingFacts): Array<{ key: string; earned: boolean; progress: number; target: number; detail: string }> {
  const roi = facts.staked > 0 ? facts.profit / facts.staked : 0;
  const clvRate = facts.closingTracked ? facts.beatClosing / facts.closingTracked : 0;
  const propRate = facts.propSettled ? facts.propWins / facts.propSettled : 0;
  return [
    { key: "first_pick", earned: facts.picks >= 1, progress: Math.min(facts.picks, 1), target: 1, detail: `${facts.picks} picks shared` },
    { key: "hot_streak", earned: facts.longestWinStreak >= 5, progress: Math.min(facts.longestWinStreak, 5), target: 5, detail: `Best run: ${facts.longestWinStreak} straight wins` },
    { key: "roi_king", earned: facts.settled >= 30 && roi >= 0.1, progress: Math.min(facts.settled, 30), target: 30, detail: `${facts.settled} settled · ROI ${pct(roi)}` },
    { key: "sharp_bettor", earned: facts.closingTracked >= 20 && clvRate >= 0.6, progress: Math.min(facts.closingTracked, 20), target: 20, detail: `${facts.closingTracked} with closing odds · beat close ${pct(clvRate)}` },
    { key: "prop_hunter", earned: facts.propSettled >= 25 && propRate >= 0.55, progress: Math.min(facts.propSettled, 25), target: 25, detail: `${facts.propSettled} settled props · ${pct(propRate)} won` },
    { key: "line_shopper", earned: facts.books >= 5, progress: Math.min(facts.books, 5), target: 5, detail: `${facts.books} sportsbooks used` },
    { key: "arbitrage_expert", earned: facts.hedgedPairs >= 3, progress: Math.min(facts.hedgedPairs, 3), target: 3, detail: `${facts.hedgedPairs} two-sided markets` },
    { key: "grinder", earned: facts.bets >= 100, progress: Math.min(facts.bets, 100), target: 100, detail: `${facts.bets} bets tracked` },
    { key: "crowd_favorite", earned: facts.tailsReceived >= 25, progress: Math.min(facts.tailsReceived, 25), target: 25, detail: `${facts.tailsReceived} tails received` },
    { key: "on_a_roll", earned: facts.bestVisitStreak >= 7, progress: Math.min(facts.bestVisitStreak, 7), target: 7, detail: `Best streak: ${facts.bestVisitStreak} days` },
  ];
}

/** Longest and current run of consecutive wins (pushes don't break or extend a run). */
export function winStreaks(results: string[]): { longest: number; current: number } {
  let longest = 0;
  let run = 0;
  for (const result of results) {
    if (result === "win") { run += 1; longest = Math.max(longest, run); } else if (result === "loss") run = 0;
  }
  return { longest, current: run };
}

export async function bettingFacts(userId: number): Promise<BettingFacts> {
  const [totals, results, hedges, social, profile] = await Promise.all([
    pool.query<Record<string, string | null>>(
      `SELECT COUNT(*) AS bets,
         COUNT(*) FILTER (WHERE result IN ('win','loss','push')) AS settled,
         COUNT(*) FILTER (WHERE result='win') AS wins,
         COALESCE(SUM(stake) FILTER (WHERE result IN ('win','loss','push')), 0) AS staked,
         COALESCE(SUM(profit_loss) FILTER (WHERE result IN ('win','loss','push')), 0) AS profit,
         COUNT(*) FILTER (WHERE closing_odds IS NOT NULL AND result IN ('win','loss','push')) AS closing_tracked,
         COUNT(*) FILTER (WHERE closing_odds IS NOT NULL AND result IN ('win','loss','push') AND odds > closing_odds) AS beat_closing,
         COUNT(*) FILTER (WHERE (market_key ~ '^(player_|batter_|pitcher_)' OR bet_type ILIKE '%prop%') AND result IN ('win','loss')) AS prop_settled,
         COUNT(*) FILTER (WHERE (market_key ~ '^(player_|batter_|pitcher_)' OR bet_type ILIKE '%prop%') AND result='win') AS prop_wins,
         COUNT(DISTINCT lower(sportsbook)) AS books
       FROM bets WHERE user_id=$1`, [userId]),
    pool.query<{ result: string }>("SELECT result FROM bets WHERE user_id=$1 AND result IN ('win','loss','push') ORDER BY bet_date, id", [userId]),
    pool.query<{ pairs: string }>(
      `SELECT COUNT(*) AS pairs FROM (
         SELECT COALESCE(event_id, lower(event)) AS ev, market_key FROM bets WHERE user_id=$1
         GROUP BY 1, 2 HAVING COUNT(DISTINCT lower(COALESCE(NULLIF(selection, ''), team_player))) >= 2 AND COUNT(DISTINCT lower(sportsbook)) >= 2
       ) pairs`, [userId]),
    pool.query<Record<string, string>>(
      `SELECT (SELECT COUNT(*) FROM posts WHERE user_id=$1 AND kind='pick') AS picks,
         (SELECT COUNT(*) FROM reactions r JOIN posts p ON p.id=r.post_id WHERE p.user_id=$1 AND r.reaction='tail' AND r.user_id<>$1) AS tails,
         (SELECT COUNT(*) FROM reactions r JOIN posts p ON p.id=r.post_id WHERE p.user_id=$1 AND r.user_id<>$1) AS reactions,
         (SELECT COUNT(*) FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.user_id=$1 AND c.user_id<>$1) AS comments`, [userId]),
    pool.query<{ visit_days: number; best_streak: number }>("SELECT visit_days, best_streak FROM user_profiles WHERE user_id=$1", [userId]),
  ]);
  const t = totals.rows[0]!;
  const streaks = winStreaks(results.rows.map((row) => row.result));
  const s = social.rows[0]!;
  return {
    bets: Number(t.bets), settled: Number(t.settled), wins: Number(t.wins), staked: Number(t.staked), profit: Number(t.profit),
    longestWinStreak: streaks.longest, currentWinStreak: streaks.current,
    closingTracked: Number(t.closing_tracked), beatClosing: Number(t.beat_closing), propSettled: Number(t.prop_settled), propWins: Number(t.prop_wins),
    books: Number(t.books), hedgedPairs: Number(hedges.rows[0]?.pairs ?? 0),
    picks: Number(s.picks), tailsReceived: Number(s.tails), reactionsReceived: Number(s.reactions), commentsReceived: Number(s.comments),
    visitDays: profile.rows[0]?.visit_days ?? 0, bestVisitStreak: profile.rows[0]?.best_streak ?? 0,
  };
}

let catalog: BadgeDef[] | null = null;
export async function badgeCatalog(): Promise<BadgeDef[]> {
  if (!catalog) catalog = (await pool.query<BadgeDef>("SELECT key, name, description, icon, xp FROM badges ORDER BY sort_order")).rows;
  return catalog;
}

const inflight = new Map<number, Promise<void>>();

/**
 * Awards newly earned badges (with a notification and a feed event), then recomputes XP and level.
 * Runs after bets change, picks are shared, reactions arrive and on daily visits.
 */
export function evaluateUser(userId: number): Promise<void> {
  const running = inflight.get(userId);
  if (running) return running;
  const task = (async () => {
    const [facts, badges, earned] = await Promise.all([
      bettingFacts(userId), badgeCatalog(),
      pool.query<{ badge_key: string }>("SELECT badge_key FROM achievements WHERE user_id=$1", [userId]),
    ]);
    const have = new Set(earned.rows.map((row) => row.badge_key));
    const fresh = badgeProgress(facts).filter((item) => item.earned && !have.has(item.key)).map((item) => badges.find((badge) => badge.key === item.key)!).filter(Boolean);
    if (fresh.length) {
      await pool.query("INSERT INTO achievements(user_id, badge_key) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING", [userId, fresh.map((badge) => badge.key)]);
      const handle = await pool.query<{ handle: string }>("SELECT handle FROM user_profiles WHERE user_id=$1", [userId]);
      await notify(fresh.map((badge) => ({ userId, type: "achievement" as const, title: `Badge earned: ${badge.name}`, body: `${badge.description} +${badge.xp} XP`, link: { page: "Community", handle: handle.rows[0]?.handle }, dedupeKey: `badge:${badge.key}` })));
      for (const badge of fresh) await addFeedEvent({ type: "achievement", actorUserId: userId, title: `earned the ${badge.name} badge`, body: badge.description, ref: { badge: badge.key }, dedupeKey: `badge:${userId}:${badge.key}` });
    }
    const badgeXp = badges.filter((badge) => have.has(badge.key) || fresh.some((item) => item.key === badge.key)).reduce((total, badge) => total + badge.xp, 0);
    const xp = xpFrom(facts, badgeXp);
    await pool.query("UPDATE user_profiles SET xp=$2, level=$3, updated_at=NOW() WHERE user_id=$1", [userId, xp, levelFor(xp).level]);
  })().catch((error: unknown) => console.warn("Gamification update failed", error instanceof Error ? error.message : error)).finally(() => inflight.delete(userId));
  inflight.set(userId, task);
  return task;
}

export async function achievementsFor(userId: number): Promise<{ xp: number; level: ReturnType<typeof levelFor>; badges: BadgeProgress[]; facts: BettingFacts; streak: { days: number; best: number } }> {
  const [facts, badges, earned, profile] = await Promise.all([
    bettingFacts(userId), badgeCatalog(),
    pool.query<{ badge_key: string; earned_at: Date }>("SELECT badge_key, earned_at FROM achievements WHERE user_id=$1", [userId]),
    pool.query<{ xp: number; streak_days: number; best_streak: number }>("SELECT xp, streak_days, best_streak FROM user_profiles WHERE user_id=$1", [userId]),
  ]);
  const earnedAt = new Map(earned.rows.map((row) => [row.badge_key, row.earned_at.toISOString()]));
  const progress = new Map(badgeProgress(facts).map((item) => [item.key, item]));
  const xp = profile.rows[0]?.xp ?? 0;
  return {
    xp,
    level: levelFor(xp),
    badges: badges.map((badge) => {
      const item = progress.get(badge.key)!;
      return { ...badge, earned: earnedAt.has(badge.key), earnedAt: earnedAt.get(badge.key) ?? null, progress: item.progress, target: item.target, detail: item.detail };
    }),
    facts,
    streak: { days: profile.rows[0]?.streak_days ?? 0, best: profile.rows[0]?.best_streak ?? 0 },
  };
}
